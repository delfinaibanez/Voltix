#!/usr/bin/env node
'use strict';
/**
 * TP_06 - Evidencia de persistencia: los datos sobreviven a la eliminación y recreación
 * de los contenedores mientras no se borren los volúmenes.
 *
 * Qué hace (todo con Docker Compose levantado):
 *   1. Crea datos: un usuario (auth), una orden (orders) que reserva stock (inventory).
 *   2. Anota los IDs de los contenedores de las bases y el estado del stock.
 *   3. `docker compose down` (SIN -v: los volúmenes se conservan) y `docker compose up -d`.
 *   4. Comprueba que los contenedores son otros (se recrearon), que los volúmenes siguen y
 *      que el usuario, la orden, el stock y el catálogo se recuperan.
 *
 * Uso (desde la raíz del repo, con las mismas variables que tp06-microservicios.js):
 *   node scripts/pruebas/tp06-persistencia.js 2>&1 | Tee-Object -FilePath docs\evidencias\tp06-persistencia.txt
 *
 * Importante: INVENTORY_URL puede apuntar a cualquier nodo (solo se hacen lecturas ahí).
 */
const c = require('./lib/common');
const { cfg } = c;

const DB_SERVICES = ['auth-db', 'catalog-db', 'orders-db', 'inventory-1-db', 'inventory-2-db', 'inventory-3-db'];

const containerIds = () =>
  Object.fromEntries(DB_SERVICES.map((s) => [s, c.sh(`docker compose ps -q ${s}`).trim().slice(0, 12)]));

(async () => {
  const r = c.createReporter('TP_06 - Persistencia tras eliminar y recrear contenedores');
  if (!cfg.jwtSecret) {
    console.error('Falta JWT_SECRET (variable de entorno).');
    process.exit(1);
  }
  if (!c.dockerRunning(cfg.compose.orders)) {
    r.skip('PERSIST', 'Persistencia con Docker Compose', 'los servicios no corren en Compose (o --sin-docker)');
    return r.summary();
  }

  const stamp = Date.now();
  const email = `persistencia.${stamp}@voltix.test`;
  const password = `Voltix#${stamp}aZ`;
  const [product] = await c.getProducts(1);
  if (!product) {
    r.check('PERSIST', 'Hay un producto activo en el catálogo', true, false);
    return r.summary();
  }

  // ---------- 1. Crear datos ----------
  console.log('--- 1. Creación de datos ---');
  const reg = await c.registerAndLogin(email, password);
  r.check('P1', 'Se registra un usuario nuevo', 201, reg.reg.status);
  r.check('P2', 'El usuario inicia sesión', 200, reg.login.status, !!reg.token, 'sin token');
  const claims = c.decodeJwt(reg.token);

  let res = await c.call(cfg.orders, 'POST', '/api/orders', {
    token: reg.token,
    body: { items: [{ productId: product.id, quantity: 2 }] },
  });
  r.check('P3', 'Se crea una orden que reserva 2 unidades', 201, res.status, !!res.body?.id, 'sin id de orden');
  const order = res.body;

  await c.sleep(3000); // el follower consultado puede ir apenas atrasado
  const stockBefore = await c.stockOf(product.id);
  r.check('P4', 'Se registra el estado del stock tras la reserva', true, !!stockBefore);
  console.log(`      usuario ${claims?.sub} | orden ${order?.id} (total ${order?.total}) | stock ${JSON.stringify(stockBefore)}`);

  // ---------- 2. Eliminar y recrear contenedores ----------
  console.log('\n--- 2. docker compose down (sin -v) + up -d ---');
  const idsBefore = containerIds();
  console.log('      contenedores antes: ', JSON.stringify(idsBefore));
  c.sh('docker compose down');
  console.log('      contenedores eliminados (docker compose down, sin -v)');
  c.sh('docker compose up -d');
  const healthy = (await Promise.all([cfg.auth, cfg.catalog, cfg.orders, cfg.inventory].map((b) => c.waitHealth(b)))).every(Boolean);
  r.check('P5', 'Los servicios vuelven a estar saludables', true, healthy);
  const idsAfter = containerIds();
  console.log('      contenedores después:', JSON.stringify(idsAfter));
  const recreated = DB_SERVICES.every((s) => idsBefore[s] && idsAfter[s] && idsBefore[s] !== idsAfter[s]);
  r.check('P6', 'Los contenedores de las bases son nuevos (se eliminaron y recrearon)', true, recreated, 'algún ID no cambió');

  // ---------- 3. Los volúmenes siguen ----------
  const declared = c.sh('docker compose config --volumes').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const existing = c.sh('docker volume ls --format "{{.Name}}"').split(/\r?\n/).map((s) => s.trim());
  const missing = declared.filter((v) => !existing.some((e) => e === v || e.endsWith(`_${v}`)));
  console.log(`      volúmenes declarados: ${declared.join(', ')}`);
  r.check('P7', 'Todos los volúmenes siguen existiendo', 0, missing.length, true, `faltan: ${missing.join(', ')}`);

  // ---------- 4. Recuperación de los datos ----------
  console.log('\n--- 3. Recuperación de datos ---');
  const login = await c.call(cfg.auth, 'POST', cfg.loginPath, { body: c.loginBody(email, password) });
  r.check('P8', 'El usuario creado antes sigue existiendo y puede iniciar sesión', 200, login.status);
  const token = c.extractToken(login.body) || reg.token;

  res = await c.call(cfg.orders, 'GET', `/api/orders/${order.id}`, { token });
  r.check('P9', 'La orden creada antes se recupera con los mismos datos', 200, res.status,
    res.body?.id === order.id && res.body?.total === order.total && res.body?.status === 'CONFIRMED',
    'id, total o estado distintos');

  let stockAfter = null;
  for (let i = 0; i < 20; i += 1) { // hasta ~40 s: los nodos de inventario se vuelven a sincronizar
    stockAfter = await c.stockOf(product.id);
    if (stockAfter && stockBefore && stockAfter.available === stockBefore.available && stockAfter.reserved === stockBefore.reserved) break;
    await c.sleep(2000);
  }
  r.check('P10', 'El stock y las reservas se recuperan iguales', true,
    !!stockAfter && stockAfter.available === stockBefore.available && stockAfter.reserved === stockBefore.reserved,
    `antes ${JSON.stringify(stockBefore)}, después ${JSON.stringify(stockAfter)}`);

  res = await c.call(cfg.catalog, 'GET', `/api/products/${product.id}`);
  r.check('P11', 'El producto del catálogo sigue existiendo', 200, res.status);

  // ---------- Limpieza: cancelar la orden libera el stock ----------
  let cancel = { status: 0 };
  for (let i = 0; i < 15; i += 1) { // si el cluster todavía elige líder, orders responde 503
    cancel = await c.call(cfg.orders, 'POST', `/api/orders/${order.id}/cancel`, { token });
    if (cancel.status !== 503) break;
    await c.sleep(2000);
  }
  r.check('P12', 'La orden recuperada se puede operar (cancelar libera el stock)', 200, cancel.status);

  r.summary();
})();
