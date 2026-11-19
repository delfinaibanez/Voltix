const config = require('../config/env');
const { Stock } = require('../models/stock.model');
const AppError = require('../utils/appError');
const { applyCommand } = require('./stock.commands');
const { withProductLock } = require('./lock.service');
const raft = require('../raft');

// Lecturas: no necesitan lock. Se leen de este nodo; en un follower pueden ir
// apenas atrasadas respecto del líder hasta que aplique las últimas entradas.
async function getStock(productId) {
  const stock = await Stock.findOne({ productId });
  if (!stock) throw AppError.notFound(`No hay stock registrado para el producto ${productId}`);
  return stock.toJSON();
}

// Escrituras: el lock de Redis decide quién entra a la sección crítica del
// producto; con Raft activo, el líder replica el comando y lo aplica recién
// cuando la mayoría lo confirmó (cada nodo lo aplica con applyCommand, en orden).
// Un follower rechaza la escritura e informa quién es el líder.
async function execute(command) {
  const run = () => (raft.isEnabled() ? raft.propose(command) : applyCommand(command));
  if (!config.lock.enabled) return run(); // solo para la demo de carrera
  return withProductLock(command.productId, run);
}

const setStock = (productId, { available }) =>
  execute({ type: 'SET_STOCK', productId, available });

const reserve = (productId, { orderId, quantity }) =>
  execute({ type: 'RESERVE', productId, orderId, quantity });

const release = (productId, { orderId }) => execute({ type: 'RELEASE', productId, orderId });

module.exports = { getStock, setStock, reserve, release, execute };