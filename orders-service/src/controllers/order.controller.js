const orderService = require('../services/order.service');
const { validateCreateOrderBody, parseListQuery } = require('../utils/validators');
const { getIdentity } = require('../utils/identity');
const logger = require('../utils/logger');

// Express 5 captura automáticamente los errores de handlers async.
// El header Authorization se reenvía tal cual a catalog e inventory (TP7 13).

async function create(req, res) {
  const { items } = validateCreateOrderBody(req.body);
  const order = await orderService.createOrder(getIdentity(req), items, req.headers.authorization);
  logger.info('Orden creada', { orderId: order.id, userId: order.userId, total: order.total, items: order.items.length });
  res.status(201).location(`${req.baseUrl}/${order.id}`).json(order);
}

async function list(req, res) {
  res.json(await orderService.listOrders(getIdentity(req), parseListQuery(req.query)));
}

async function getById(req, res) {
  res.json(await orderService.getAccessibleOrder(getIdentity(req), req.params.id));
}

async function cancel(req, res) {
  const order = await orderService.cancelOrder(getIdentity(req), req.params.id, req.headers.authorization);
  logger.info('Orden cancelada', { orderId: order.id, userId: order.userId });
  res.json(order);
}

module.exports = { create, list, getById, cancel };
