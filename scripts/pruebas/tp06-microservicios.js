#!/usr/bin/env node
'use strict';
/**
 * TP_06 - Pruebas de microservicios: health, CRUD/negocio, comunicación entre servicios,
 * semántica de errores (404/409 no se convierten en 503) y caída de una dependencia (503).
 *
 * Uso (desde la raíz del repo, con la solución levantada):
 *   node scripts/pruebas/tp06-microservicios.js [--sin-docker]
 *
 * Requiere JWT_SECRET (se lee de la variable de entorno, de scripts/pruebas/.env o de
 * orders-service/.env): los tokens USER/ADMIN se firman localmente, así las pruebas no dependen de auth.
 * La sección FALLO detiene/arranca catalog-service e inventory-service con `docker compose`;
 * con --sin-docker, o si no corren en Compose, se omite.
 * Sale con código 1 si hay algún FAIL.
 */
const c = require('./lib/common');
const { cfg } = c;

(async () => {
  const r = c.createReporter('TP_06 - Microservicios y Docker');
  if (!cfg.jwtSecret) {
    console.error('Falta JWT_SECRET (variable de entorno o orders-service/.env).');
    process.exit(1);
  }
  const userToken = c.signJwt({ sub: 'tp06-usuario', role: 'USER' });
  const adminToken = c.signJwt({ sub: 'tp06-admin', role: 'ADMIN' });
  const U = { token: userToken };

  // ---------- HEALTH ----------
  for (const [name, base] of [['catalog-service', cfg.catalog], ['inventory-service', cfg.inventory],
    ['orders-service', cfg.orders], ['auth-service', cfg.auth]]) {
    const res = await c.call(base, 'GET', '/health');
    r.check('HEALTH', `${name} GET /health`, 200, res.status,
      // En Compose inventory-service corre como inventory-1/2/3 (SERVICE_NAME por nodo).
      (res.body?.service === name || (name === 'inventory-service' && /^inventory-service|^inventory-\d+$/.test(res.body?.service || ''))) &&
      res.body?.status === 'ok', `se esperaba {service:"${name}",status:"ok"}`);
  }

  // ---------- CRUD catálogo ----------
  const products = await c.getProducts(2);
  if (!products.length) {
    console.log('\nNo hay productos activos en el catálogo: cargá datos de prueba y reintentá.');
    r.check('CRUD-CAT', 'Catálogo con productos activos', true, false);
    return r.summary();
  }
  const P = products[0];
  const price = Number(P.price);
  let res = await c.call(cfg.catalog, 'GET', '/api/products');
  r.check('CRUD-CAT', 'GET /api/products (lista paginada)', 200, res.status, c.extractList(res.body).length > 0, 'lista vacía');
  res = await c.call(cfg.catalog, 'GET', `/api/products/${P.id}`);
  r.check('CRUD-CAT', 'GET /api/products/:id', 200, res.status, !!res.body?.sku && Number(res.body?.price) === price, 'faltan sku/price');
  res = await c.call(cfg.catalog, 'GET', '/api/products/abc');
  r.check('CRUD-CAT', 'GET /api/products/abc (id inválido)', 400, res.status);
  res = await c.call(cfg.catalog, 'GET', `/api/products/${c.ZERO_ID}`);
  r.check('CRUD-CAT', 'GET /api/products/<inexistente>', 404, res.status);

  // ---------- CRUD inventario ----------
  res = await c.call(cfg.inventory, 'GET', `/api/stock/${c.ZERO_ID}`, U);
  r.check('CRUD-INV', 'GET /api/stock/<sin stock>', 404, res.status);
  res = await c.call(cfg.inventory, 'PUT', `/api/stock/${P.id}`, { token: adminToken, body: { available: 40 } });
  r.check('CRUD-INV', 'PUT /api/stock/:id (ADMIN) available=40', [200, 201], res.status);
  res = await c.call(cfg.inventory, 'GET', `/api/stock/${P.id}`, U);
  r.check('CRUD-INV', 'GET /api/stock/:id', 200, res.status, res.body?.available === 40, 'available≠40');

  const o1 = c.newId();
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/reserve`, { ...U, body: { orderId: o1, quantity: 3 } });
  r.check('CRUD-INV', 'POST reserve', 201, res.status, res.body?.status === 'RESERVED', 'status≠RESERVED');
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/reserve`, { ...U, body: { orderId: o1, quantity: 3 } });
  r.check('CRUD-INV', 'POST reserve repetido (idempotente)', 200, res.status, res.body?.status === 'RESERVED');
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/reserve`, { ...U, body: { orderId: c.newId(), quantity: 9999 } });
  r.check('CRUD-INV', 'POST reserve con stock insuficiente', 409, res.status);
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${c.ZERO_ID}/reserve`, { ...U, body: { orderId: c.newId(), quantity: 1 } });
  r.check('CRUD-INV', 'POST reserve de producto sin stock cargado', 404, res.status);
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/reserve`, { ...U, body: { orderId: c.newId(), quantity: 0 } });
  r.check('CRUD-INV', 'POST reserve con quantity inválida', 400, res.status);
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/release`, { ...U, body: { orderId: o1 } });
  r.check('CRUD-INV', 'POST release', 200, res.status, res.body?.status === 'RELEASED', 'status≠RELEASED');
  res = await c.call(cfg.inventory, 'POST', `/api/stock/${P.id}/release`, { ...U, body: { orderId: c.newId() } });
  r.check('CRUD-INV', 'POST release de reserva inexistente', 404, res.status);

  // ---------- CRUD órdenes + COMUNICACIÓN ----------
  const body = (items) => ({ items });
  const s0 = await c.stockOf(P.id);
  // El cliente NO puede mandar precio: orders lo rechaza (400) y lo toma del catálogo.
  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 2, unitPrice: 1 }]) });
  r.check('COM', 'POST /api/orders con unitPrice enviado por el cliente es rechazado', 400, res.status);
  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: { items: [{ productId: P.id, quantity: 1 }], userId: 'otro' } });
  r.check('COM', 'POST /api/orders con userId en el body es rechazado (sale del token)', 400, res.status);

  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 2 }]) });
  const order = res.body;
  const s1 = await c.stockOf(P.id);
  r.check('COM', 'POST /api/orders: precio/nombre tomados del catálogo, total y userId del token', 201, res.status,
    order?.status === 'CONFIRMED' && order?.userId === 'tp06-usuario' &&
    Number(order?.items?.[0]?.unitPrice) === price && Number(order?.total) === price * 2 && !!order?.items?.[0]?.name,
    'status/userId/unitPrice/total/name incorrectos');
  r.check('COM', 'orders→inventory: el stock quedó reservado', true,
    !!s0 && !!s1 && (s1.reserved === s0.reserved + 2 || s1.available === s0.available - 2));

  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([]) });
  r.check('CRUD-ORD', 'POST /api/orders con items vacío', 400, res.status);
  res = await c.call(cfg.orders, 'GET', '/api/orders', U);
  r.check('CRUD-ORD', 'GET /api/orders', 200, res.status, JSON.stringify(res.body).includes(order?.id || '¿'), 'no aparece la orden creada');
  res = await c.call(cfg.orders, 'GET', `/api/orders/${order?.id}`, U);
  r.check('CRUD-ORD', 'GET /api/orders/:id', 200, res.status);
  res = await c.call(cfg.orders, 'GET', `/api/orders/${c.ZERO_ID}`, U);
  r.check('CRUD-ORD', 'GET /api/orders/<inexistente>', 404, res.status);
  res = await c.call(cfg.orders, 'POST', `/api/orders/${order?.id}/cancel`, U);
  const s2 = await c.stockOf(P.id);
  r.check('CRUD-ORD', 'POST cancel (libera el stock)', 200, res.status,
    res.body?.status === 'CANCELLED' && s2?.reserved === s0.reserved && s2?.available === s0.available,
    'status≠CANCELLED o el stock no volvió al valor inicial');
  res = await c.call(cfg.orders, 'POST', `/api/orders/${order?.id}/cancel`, U);
  r.check('CRUD-ORD', 'POST cancel de orden ya cancelada', 409, res.status);

  // ---------- Semántica de errores entre servicios + compensación ----------
  const sb = await c.stockOf(P.id);
  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 1 }, { productId: c.ZERO_ID, quantity: 1 }]) });
  let sa = await c.stockOf(P.id);
  r.check('ERR', 'Producto inexistente en catálogo → 404 (no 503) y sin reservas huérfanas', 404, res.status,
    sa?.reserved === sb.reserved && sa?.available === sb.available, 'quedó stock reservado');
  res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 9999 }]) });
  r.check('ERR', 'Stock insuficiente → 409 propagado desde inventory', 409, res.status);

  if (products[1]) {
    const P2 = products[1];
    await c.call(cfg.inventory, 'PUT', `/api/stock/${P2.id}`, { token: adminToken, body: { available: 0 } });
    const before = await c.stockOf(P.id);
    res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 1 }, { productId: P2.id, quantity: 1 }]) });
    sa = await c.stockOf(P.id);
    r.check('ERR', 'Compensación: 2º ítem sin stock → 409 y se libera la reserva del 1º', 409, res.status,
      sa?.reserved === before.reserved && sa?.available === before.available, 'la reserva del 1º ítem no se liberó');
  } else r.skip('ERR', 'Compensación con 2 productos', 'el catálogo tiene un solo producto activo');

  // ---------- FALLO: caída de una dependencia → 503 ----------
  for (const [key, base, name] of [['catalog', cfg.catalog, 'catalog-service'], ['inventory', cfg.inventory, 'inventory-service']]) {
    const svc = cfg.compose[key];
    if (!c.dockerRunning(svc)) {
      r.skip('FALLO', `Caída de ${name}`, `no corre en Compose (o --sin-docker). Manual: docker compose stop ${c.svcList(svc).join(' ')}; POST /api/orders → 503; docker compose start ${c.svcList(svc).join(' ')}`);
      continue;
    }
    try {
      c.sh(`docker compose stop ${c.svcList(svc).join(' ')}`);
      res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 1 }]) });
      r.check('FALLO', `${name} detenido: POST /api/orders responde 503 nombrando la dependencia`, 503, res.status,
        new RegExp(key, 'i').test(res.text), `la respuesta no menciona "${key}"`);
      const h = await c.call(cfg.orders, 'GET', '/health');
      r.check('FALLO', 'orders-service sigue vivo (/health)', 200, h.status);
    } finally {
      try { c.sh(`docker compose start ${c.svcList(svc).join(' ')}`); } catch { /* ya se informa abajo */ }
    }
    const up = await c.waitHealth(base);
    res = await c.call(cfg.orders, 'POST', '/api/orders', { ...U, body: body([{ productId: P.id, quantity: 1 }]) });
    r.check('FALLO', `${name} reiniciado: el caso de uso se recupera`, 201, res.status, up, 'el servicio no volvió a estar saludable');
    if (res.body?.id) await c.call(cfg.orders, 'POST', `/api/orders/${res.body.id}/cancel`, U);
  }

  r.summary();
})();
