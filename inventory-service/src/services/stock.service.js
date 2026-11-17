const config = require('../config/env');
const { Stock } = require('../models/stock.model');
const AppError = require('../utils/appError');
const { applyCommand } = require('./stock.commands');
const { withProductLock } = require('./lock.service');

// Lecturas: no necesitan lock.
async function getStock(productId) {
  const stock = await Stock.findOne({ productId });
  if (!stock) throw AppError.notFound(`No hay stock registrado para el producto ${productId}`);
  return stock.toJSON();
}

// Escrituras: se toma el lock del producto y se aplica el comando.
// Raft se enchufa acá: en lugar de llamar a applyCommand directamente, el líder
// replica el comando y cada nodo lo aplica con applyCommand.
async function execute(command) {
  if (!config.lock.enabled) return applyCommand(command); // solo para la demo de carrera
  return withProductLock(command.productId, () => applyCommand(command));
}

const setStock = (productId, { available }) =>
  execute({ type: 'SET_STOCK', productId, available });

const reserve = (productId, { orderId, quantity }) =>
  execute({ type: 'RESERVE', productId, orderId, quantity });

const release = (productId, { orderId }) => execute({ type: 'RELEASE', productId, orderId });

module.exports = { getStock, setStock, reserve, release, execute };
