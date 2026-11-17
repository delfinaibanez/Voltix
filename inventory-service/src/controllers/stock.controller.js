const stockService = require('../services/stock.service');
const {
  validateSetStockBody,
  validateReserveBody,
  validateReleaseBody,
} = require('../utils/validators');
const logger = require('../utils/logger');

// Express 5 captura automáticamente los errores de handlers async.

async function getStock(req, res) {
  res.json(await stockService.getStock(req.params.productId));
}

async function setStock(req, res) {
  const data = validateSetStockBody(req.body);
  const { created, data: stock } = await stockService.setStock(req.params.productId, data);
  logger.info(created ? 'Stock creado' : 'Stock actualizado', {
    productId: stock.productId,
    available: stock.available,
  });
  res.status(created ? 201 : 200).json(stock);
}

async function reserve(req, res) {
  const data = validateReserveBody(req.body);
  const { created, data: reservation } = await stockService.reserve(req.params.productId, data);
  logger.info(created ? 'Stock reservado' : 'Reserva repetida (idempotente)', {
    orderId: reservation.orderId,
    productId: reservation.productId,
    quantity: reservation.quantity,
  });
  res.status(created ? 201 : 200).json(reservation);
}

async function release(req, res) {
  const data = validateReleaseBody(req.body);
  const { data: reservation } = await stockService.release(req.params.productId, data);
  logger.info('Reserva liberada', {
    orderId: reservation.orderId,
    productId: reservation.productId,
    quantity: reservation.quantity,
  });
  res.json(reservation);
}

module.exports = { getStock, setStock, reserve, release };
