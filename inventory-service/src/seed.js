// Stock inicial: npm run seed
// Lee los productos de catalog-service (CATALOG_SERVICE_URL) y deja 50 unidades
// disponibles para cada uno. Es idempotente: se puede ejecutar varias veces.
//
// Dos modos:
//   - RAFT_ENABLED=false (nodo único): escribe con applyCommand (SET_STOCK) en la base local.
//   - RAFT_ENABLED=true (cluster):     el stock se carga por la API del líder (PUT /api/stock/:id),
//     así la escritura pasa por Raft y llega a los 3 nodos. Hay que correrlo con el cluster
//     levantado; el seed firma un token ADMIN con JWT_SECRET (o usa SEED_TOKEN si está definido).
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { Stock } = require('./models/stock.model');
const { Reservation } = require('./models/reservation.model');
const { applyCommand } = require('./services/stock.commands');
const { listAllProducts } = require('./clients/catalog.client');

const INITIAL_STOCK = 50;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedDirect(products) {
  await connectWithRetry();
  await Promise.all([Stock.init(), Reservation.init()]);

  let created = 0;
  let updated = 0;
  for (const product of products) {
    const { created: isNew } = await applyCommand({
      type: 'SET_STOCK',
      productId: product.id,
      available: INITIAL_STOCK,
    });
    if (isNew) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

function adminToken() {
  if (process.env.SEED_TOKEN) return process.env.SEED_TOKEN;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Con Raft activo el seed necesita JWT_SECRET (32+ caracteres) o SEED_TOKEN en el entorno');
  }
  return jwt.sign({ role: 'ADMIN' }, secret, {
    algorithm: 'HS256',
    subject: 'seed-inventory',
    issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
    expiresIn: '10m',
  });
}

// Prueba los nodos de RAFT_PEERS hasta dar con el líder: un follower responde 307
// (o 503) e indica quién es. Se usan las URLs INTERNAS del cluster, no las públicas.
async function putStockThroughLeader(productId, token) {
  const byId = Object.fromEntries(config.raft.peers.map((p) => [p.id, p.url]));
  let target = config.raft.nodeId;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    let response;
    try {
      response = await fetch(`${byId[target]}/api/stock/${productId}`, {
        method: 'PUT',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ available: INITIAL_STOCK }),
      });
    } catch (err) {
      logger.warn('Nodo sin respuesta durante el seed', { node: target, reason: err.message });
      target = config.raft.peers[attempt % config.raft.peers.length].id;
      await sleep(500);
      continue;
    }

    if (response.status === 201 || response.status === 200) return response.status === 201;

    const body = await response.json().catch(() => ({}));
    if ((response.status === 307 || response.status === 503) && body.leader && byId[body.leader.id]) {
      target = body.leader.id;
      continue;
    }
    if (response.status === 503) {
      await sleep(1000); // todavía no hay líder o no hay quórum
      continue;
    }
    throw new Error(`PUT /api/stock/${productId} respondió ${response.status}: ${body.message || ''}`);
  }
  throw new Error('No se consiguió escribir en el líder del cluster (¿está levantado y con quórum?)');
}

async function seedThroughRaft(products) {
  const token = adminToken();
  let created = 0;
  let updated = 0;
  for (const product of products) {
    if (await putStockThroughLeader(product.id, token)) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

async function seed() {
  const products = await listAllProducts();
  if (products.length === 0) {
    logger.warn('catalog-service no devolvió productos: corré primero el seed del catálogo');
    return;
  }

  const { created, updated } = config.raft.enabled
    ? await seedThroughRaft(products)
    : await seedDirect(products);

  logger.info('Seed del inventario completado', {
    modo: config.raft.enabled ? 'raft (por el líder)' : 'directo',
    creados: created,
    actualizados: updated,
    total: products.length,
    stockPorProducto: INITIAL_STOCK,
  });
}

seed()
  .catch((err) => {
    logger.error('Falló el seed del inventario', { error: err.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    setTimeout(() => process.exit(), 300);
  });