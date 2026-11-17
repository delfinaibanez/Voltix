// Stock inicial: npm run seed
// Lee los productos de catalog-service (CATALOG_SERVICE_URL) y deja 50 unidades
// disponibles para cada uno. Es idempotente: se puede ejecutar varias veces.
// Escribe con applyCommand (SET_STOCK), igual que la API: no hay otro camino de
// escritura. Correrlo con el servicio sin tráfico (no toma el lock).
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { Stock } = require('./models/stock.model');
const { Reservation } = require('./models/reservation.model');
const { applyCommand } = require('./services/stock.commands');
const { listAllProducts } = require('./clients/catalog.client');

const INITIAL_STOCK = 50;

async function seed() {
  const products = await listAllProducts();
  if (products.length === 0) {
    logger.warn('catalog-service no devolvió productos: corré primero el seed del catálogo');
    return;
  }

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

  logger.info('Seed del inventario completado', {
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
