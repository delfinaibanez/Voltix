// Datos de prueba reproducibles: npm run seed
// Es idempotente: se puede ejecutar varias veces (upsert por sku).
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { Product } = require('./models/product.model');

const PRODUCTS = [
  { sku: 'MOU-LOGI-G203', name: 'Mouse Logitech G203 Lightsync', category: 'MOUSE', brand: 'Logitech', price: 24999, description: 'Mouse gamer 8000 DPI con iluminación RGB' },
  { sku: 'MOU-RAZ-DEATHADDER', name: 'Mouse Razer DeathAdder Essential', category: 'MOUSE', brand: 'Razer', price: 31999, description: 'Mouse ergonómico 6400 DPI' },
  { sku: 'TEC-RED-KUMARA', name: 'Teclado Mecánico Redragon Kumara', category: 'TECLADO', brand: 'Redragon', price: 45999, description: 'Teclado mecánico TKL switches Blue' },
  { sku: 'TEC-LOGI-K380', name: 'Teclado Bluetooth Logitech K380', category: 'TECLADO', brand: 'Logitech', price: 38999, description: 'Teclado compacto multidispositivo' },
  { sku: 'AUR-HYP-CLOUD2', name: 'Auriculares HyperX Cloud II', category: 'AURICULARES', brand: 'HyperX', price: 89999, description: 'Auriculares gamer 7.1 con micrófono' },
  { sku: 'AUR-JBL-T510', name: 'Auriculares Bluetooth JBL Tune 510BT', category: 'AURICULARES', brand: 'JBL', price: 42999, description: 'Auriculares inalámbricos on-ear' },
  { sku: 'MON-SAM-24', name: 'Monitor Samsung 24" Full HD', category: 'MONITOR', brand: 'Samsung', price: 189999, description: 'Monitor IPS 75Hz' },
  { sku: 'WEB-LOGI-C920', name: 'Webcam Logitech C920 HD Pro', category: 'WEBCAM', brand: 'Logitech', price: 79999, description: 'Webcam Full HD 1080p' },
  { sku: 'SSD-KIN-480', name: 'SSD Kingston A400 480GB', category: 'ALMACENAMIENTO', brand: 'Kingston', price: 39999, description: 'Unidad de estado sólido SATA 2.5"' },
  { sku: 'CAB-HDMI-2M', name: 'Cable HDMI 2.0 de 2 metros', category: 'CABLES', brand: 'Genérico', price: 6999, description: 'Cable HDMI 4K 60Hz' },
  { sku: 'SOP-NB-ALU', name: 'Soporte de aluminio para notebook', category: 'SOPORTES', brand: 'Genérico', price: 19999, description: 'Soporte regulable plegable' },
  { sku: 'ACC-PAD-XL', name: 'Mousepad XL 90x40', category: 'ACCESORIOS', brand: 'Redragon', price: 14999, description: 'Mousepad extendido antideslizante' },
];

async function seed() {
  await connectWithRetry();
  await Product.init();

  const result = await Product.bulkWrite(
    PRODUCTS.map((product) => ({
      updateOne: { filter: { sku: product.sku }, update: { $set: product }, upsert: true },
    })),
  );

  logger.info('Seed del catálogo completado', {
    creados: result.upsertedCount,
    actualizados: result.modifiedCount,
    total: PRODUCTS.length,
  });
}

seed()
  .catch((err) => {
    logger.error('Falló el seed del catálogo', { error: err.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    setTimeout(() => process.exit(), 300);
  });