#!/usr/bin/env node
'use strict';
/**
 * TP_07 - Escenarios obligatorios A a L (autenticación, autorización y JWT).
 *
 * Uso (desde la raíz del repo, con los servicios levantados):
 *   node scripts/pruebas/tp07-seguridad.js [--sin-docker]
 *
 * Variables opcionales (también en scripts/pruebas/.env, ignorado por Git):
 *   JWT_SECRET            Necesario para los escenarios G (token vencido) y para fabricar
 *                         un ADMIN si no hay uno sembrado. Si falta, se lee de orders-service/.env.
 *   ADMIN_EMAIL / ADMIN_PASSWORD   Admin real sembrado en auth-service (recomendado).
 *   AUTH_URL, CATALOG_URL, INVENTORY_URL, ORDERS_URL   (default localhost:3004/3001/3002/3003)
 *   SVC_*, AUTH_DB_NAME, USERS_COLLECTION, AUTH_MONGODB_URI   Para K y L.
 *
 * K (reinicio con Compose) y L (inspección de la BD) usan Docker; con --sin-docker se omiten.
 * Sale con código 1 si hay algún FAIL.
 */
const c = require('./lib/common');
const { cfg } = c;

(async () => {
  const r = c.createReporter('TP_07 - Autenticación, autorización y seguridad con JWT');
  const stamp = Date.now();
  const email = `prueba.${stamp}@voltix.test`;
  const email2 = `prueba2.${stamp}@voltix.test`;
  const password = `Voltix#${stamp}aZ`;

  const [product] = await c.getProducts(1);
  const productId = product?.id || c.ZERO_ID;
  if (!product) console.log('AVISO: no se pudo obtener un producto del catálogo; J dependerá de datos.\n');
  const orderBody = (q = 1) => ({ items: [{ productId, quantity: q }] });

  // ---- A: alta de usuario válido
  let res = await c.call(cfg.auth, 'POST', cfg.registerPath, { body: c.registerBody(email, password) });
  r.check('A', 'Registrar usuario válido sin exponer password/hash', 201, res.status,
    !c.leaksCredentials(res.text, password), 'la respuesta incluye password o hash');

  // ---- B: duplicado
  res = await c.call(cfg.auth, 'POST', cfg.registerPath, { body: c.registerBody(email, password) });
  r.check('B', 'Registrar usuario duplicado', 409, res.status);

  // ---- C: login válido
  const login = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(email, password) });
  const userToken = c.extractToken(login.body);
  const claims = userToken ? c.decodeJwt(userToken) : null;
  const claimsOk = !!claims && !!claims.sub && !!claims.iat && claims.exp > claims.iat &&
    ['USER', 'ADMIN'].includes(claims.role) && claims.iss === cfg.issuer &&
    !/password|hash/i.test(JSON.stringify(claims));
  r.check('C', 'Login válido devuelve JWT con sub/iat/exp/role/iss y sin datos sensibles', 200, login.status,
    claimsOk, 'claims incompletos o token ausente');
  const userSub = claims?.sub;

  // ---- D: password incorrecta / usuario inexistente
  res = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(email, 'Incorrecta#123') });
  r.check('D', 'Login con password incorrecta', 401, res.status);
  const res2 = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(`nadie.${stamp}@voltix.test`, 'Incorrecta#123') });
  r.check('D.2', 'Login con usuario inexistente (mismo mensaje que password incorrecta)', 401, res2.status,
    res.body?.message === res2.body?.message, 'el mensaje revela cuál dato falló');
  res = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: { email } });
  r.check('D.3', 'Login con datos de entrada inválidos', 400, res.status);

  // ---- E: sin token
  res = await c.call(cfg.orders, 'POST', '/api/orders', { body: orderBody() });
  r.check('E', 'Endpoint protegido sin token (POST /api/orders)', 401, res.status);
  res = await c.call(cfg.orders, 'POST', '/api/orders', { token: 'basura', body: orderBody() });
  r.check('E.2', 'Token mal formado', 401, res.status);

  // ---- F: token modificado
  if (userToken) {
    const forged = c.tamperJwt(userToken, { role: 'ADMIN' });
    res = await c.call(cfg.inventory, 'PUT', `/api/stock/${productId}`, { token: forged, body: { available: 999 } });
    r.check('F', 'Token con payload modificado (role=ADMIN) y firma original', 401, res.status);
    res = await c.call(cfg.orders, 'POST', '/api/orders', { token: c.unsignedJwt({ sub: userSub, role: 'ADMIN' }), body: orderBody() });
    r.check('F.2', 'Token sin firma (alg=none)', 401, res.status);
  } else r.skip('F', 'Token modificado', 'no se obtuvo token en C');
  if (cfg.jwtSecret) {
    const other = c.signJwt({ sub: userSub || 'x', role: 'ADMIN' }, { secret: 'otra-clave-distinta-de-32-caracteres-xx' });
    res = await c.call(cfg.orders, 'GET', '/api/orders', { token: other });
    r.check('F.3', 'Token firmado con una clave distinta', 401, res.status);
  } else r.skip('F.3', 'Token firmado con otra clave', 'falta JWT_SECRET (no es necesario, solo informativo)');

  // ---- G: token vencido
  if (cfg.jwtSecret) {
    const now = Math.floor(Date.now() / 1000);
    const expired = c.signJwt({ sub: userSub || 'x', role: 'USER' }, { iat: now - 7200, expiresIn: 3600 });
    res = await c.call(cfg.orders, 'GET', '/api/orders', { token: expired });
    r.check('G', 'Token vencido', 401, res.status);
  } else r.skip('G', 'Token vencido', 'definí JWT_SECRET (o JWT_EXPIRES_IN=5s en auth y esperá) para fabricar/obtener un token vencido');

  // ---- H: USER sin rol suficiente
  res = await c.call(cfg.inventory, 'PUT', `/api/stock/${productId}`, { token: userToken, body: { available: 10 } });
  r.check('H', 'USER intenta operación de ADMIN (PUT /api/stock/:id)', 403, res.status);

  // ---- H.2: operaciones internas de inventario (reserve/release) NO las puede hacer un USER directo
  const direct = { orderId: c.newId(), quantity: 1 };
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/reserve`, { token: userToken, body: direct });
  r.check('H.2', 'USER reserva stock directo en inventory (saltea Órdenes)', 403, res.status);
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/release`, { token: userToken, body: { orderId: direct.orderId } });
  r.check('H.3', 'USER libera stock directo en inventory', 403, res.status);
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/reserve`, { body: direct });
  r.check('H.4', 'Reservar sin token', 401, res.status);

  // ---- I: rol autorizado
  let adminToken = null;
  if (cfg.adminEmail && cfg.adminPassword) {
    const a = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(cfg.adminEmail, cfg.adminPassword) });
    adminToken = c.extractToken(a.body);
  } else if (cfg.jwtSecret) {
    adminToken = c.signJwt({ sub: 'admin-prueba', role: 'ADMIN' });
    console.log('AVISO: sin ADMIN_EMAIL/ADMIN_PASSWORD; se usa un token ADMIN firmado localmente con JWT_SECRET.');
  }
  if (adminToken) {
    res = await c.call(cfg.inventory, 'PUT', `/api/stock/${productId}`, { token: adminToken, body: { available: 50 } });
    r.check('I', 'ADMIN ejecuta PUT /api/stock/:id', [200, 201], res.status);
  } else r.skip('I', 'Rol autorizado', 'definí ADMIN_EMAIL/ADMIN_PASSWORD o JWT_SECRET');
  if (adminToken) {
    res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/reserve`, { token: adminToken, body: direct });
    r.check('I.3', 'ADMIN reserva stock directo en inventory (tampoco: solo orders-service)', 403, res.status);
    res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/release`, { token: adminToken, body: { orderId: direct.orderId } });
    r.check('I.4', 'ADMIN libera stock directo en inventory', 403, res.status);
  }

  // ---- I.5: identidad técnica de orders-service (emitida por Auth con el secreto del servicio)
  res = await c.call(cfg.auth, 'POST', '/auth/service-token', { body: { clientId: 'orders-service', clientSecret: 'secreto-incorrecto' } });
  r.check('I.5', 'Pedir token de servicio con secreto incorrecto', 401, res.status);
  if (process.env.SERVICE_CLIENT_SECRET) {
    res = await c.call(cfg.auth, 'POST', '/auth/service-token', { body: { clientId: 'orders-service', clientSecret: process.env.SERVICE_CLIENT_SECRET } });
    const svcToken = c.extractToken(res.body);
    const svcClaims = svcToken ? c.decodeJwt(svcToken) : null;
    r.check('I.6', 'orders-service obtiene su token (rol SERVICE, sub orders-service)', 200, res.status,
      svcClaims?.role === 'SERVICE' && svcClaims?.sub === 'orders-service', 'claims inesperados');
    res = await c.call(cfg.inventory, 'PUT', `/api/stock/${productId}`, { token: svcToken, body: { available: 50 } });
    r.check('I.7', 'El token de servicio no puede ajustar stock (PUT es solo ADMIN)', 403, res.status);
    res = await c.call(cfg.orders, 'GET', '/api/orders', { token: svcToken });
    r.check('I.8', 'El token de servicio no sirve como usuario en orders', 401, res.status);
    res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/reserve`, { token: svcToken, body: direct });
    r.check('I.9', 'El token de servicio SÍ puede reservar', [200, 201], res.status);
    res = await c.call(cfg.inventory, 'POST', `/api/stock/${productId}/release`, { token: svcToken, body: { orderId: direct.orderId } });
    r.check('I.10', 'El token de servicio SÍ puede liberar (deja el stock como estaba)', 200, res.status);
  } else r.skip('I.6', 'Token de servicio', 'definí SERVICE_CLIENT_SECRET (el de orders-service/.env.docker) para probar I.6 a I.10');
  res = await c.call(cfg.orders, 'POST', '/api/orders', { token: userToken, body: orderBody(1) });
  r.check('I.2', 'USER crea una orden (rol autorizado en orders)', 201, res.status);
  const firstOrderId = res.body?.id;

  // ---- J: caso de uso que atraviesa servicios (orders -> catalog + inventory)
  const before = await c.stockOf(productId);
  res = await c.call(cfg.orders, 'POST', '/api/orders', { token: userToken, body: orderBody(2) });
  const orderId = res.body?.id;
  const after = await c.stockOf(productId);
  const moved = before && after &&
    (after.reserved === before.reserved + 2 || after.available === before.available - 2);
  r.check('J', 'Orden atraviesa orders→catalog/inventory con el JWT propagado; userId = sub del token', 201, res.status,
    res.body?.userId === userSub && !!moved && res.body?.items?.[0]?.name,
    'userId≠sub, falta name de catálogo o el stock no se reservó');

  if (orderId) {
    const u2 = await c.registerAndLogin(email2, password);
    res = await c.call(cfg.orders, 'GET', `/api/orders/${orderId}`, { token: u2.token });
    r.check('J.2', 'Otro USER consulta la orden ajena (propiedad del recurso)', 403, res.status);
    res = await c.call(cfg.orders, 'GET', `/api/orders/${orderId}`, { token: userToken });
    r.check('J.3', 'El dueño consulta su orden', 200, res.status);
    if (adminToken) {
      res = await c.call(cfg.orders, 'GET', `/api/orders/${orderId}`, { token: adminToken });
      r.check('J.4', 'ADMIN consulta la orden de otro usuario', 200, res.status);
    }
    res = await c.call(cfg.orders, 'POST', `/api/orders/${orderId}/cancel`, { token: userToken });
    r.check('J.5', 'El dueño cancela su orden (libera stock en inventory)', 200, res.status);
  } else r.skip('J.2-5', 'Propiedad del recurso', 'no se creó la orden en J');
  if (firstOrderId) await c.call(cfg.orders, 'POST', `/api/orders/${firstOrderId}/cancel`, { token: userToken });

  // ---- K: reinicio con Docker Compose
  if (c.dockerRunning(cfg.compose.auth)) {
    try {
      console.log('...ejecutando "docker compose down" + "up -d" (sin -v, conserva volúmenes)');
      c.sh('docker compose down');
      c.sh('docker compose up -d');
      const healthy = (await Promise.all([cfg.auth, cfg.catalog, cfg.inventory, cfg.orders].map((b) => c.waitHealth(b)))).every(Boolean);
      res = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(email, password) });
      const t = c.extractToken(res.body);
      const ok2 = await c.call(cfg.orders, 'GET', '/api/orders', { token: t });
      r.check('K', 'Tras reiniciar Compose: el usuario persiste y vuelve a autenticar', 200, res.status,
        healthy && !!t && ok2.status === 200, 'servicios no saludables o token no aceptado');
    } catch (e) {
      r.check('K', 'Reinicio con Docker Compose', 200, 0, false, e.message.split('\n')[0]);
    }
  } else r.skip('K', 'Reinicio con Compose', `${cfg.compose.auth} no corre en Compose (o --sin-docker). Manual: docker compose down && docker compose up -d, y repetir C`);

  // ---- L: contraseña almacenada como hash
  let doc = null;
  try {
    const mongoose = c.createRequire(`${c.ROOT}/auth-service/package.json`)('mongoose');
    await mongoose.connect(cfg.authMongoUri, { serverSelectionTimeoutMS: 3000 });
    doc = await mongoose.connection.db.collection(cfg.usersCollection).findOne({ email });
    await mongoose.disconnect();
  } catch { /* se intenta vía Docker */ }
  if (!doc && c.dockerRunning(cfg.compose.authDb)) {
    try {
      const out = c.sh(`docker compose exec -T ${cfg.compose.authDb} mongosh ${cfg.authDbName} --quiet --eval "JSON.stringify(db.getCollection('${cfg.usersCollection}').findOne({email:'${email}'}))"`);
      doc = JSON.parse(out.trim().split(/\r?\n/).pop());
    } catch { /* sin acceso */ }
  }
  if (doc) {
    const hash = doc.passwordHash || doc.password_hash || doc.hash || doc.password;
    const isHash = typeof hash === 'string' && /^\$(2[aby]|argon2id)\$/.test(hash);
    const noPlain = !JSON.stringify(doc).includes(password);
    r.check('L', `Password almacenada como hash (${isHash ? hash.slice(0, 7) + '…' : 'no es hash'})`, true, isHash && noPlain);
  } else r.skip('L', 'Inspección de persistencia', 'sin acceso a la BD (ni mongoose en auth-service/node_modules ni contenedor auth-db). Manual: mongosh auth_db --eval "db.users.findOne()"');

  r.summary();
})();
