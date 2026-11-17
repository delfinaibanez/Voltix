const config = require('../config/env');
const { callService } = require('./httpClient');

const DEPENDENCY = 'inventory-service';
const call = (options) => callService({ dependency: DEPENDENCY, baseUrls: config.services.inventoryUrls, ...options });

// POST /api/stock/:productId/reserve -> 201 (nueva) | 200 (repetida, idempotente)
// 404 sin stock registrado, 409 stock insuficiente.
async function reserve(productId, { orderId, quantity }, authorization) {
  const { data } = await call({
    method: 'POST',
    path: `/api/stock/${encodeURIComponent(productId)}/reserve`,
    authorization,
    body: { orderId, quantity },
    notFoundMessage: `No hay stock registrado para el producto ${productId}`,
  });
  return data;
}

// POST /api/stock/:productId/release -> 200 { status: "RELEASED" } | 404 sin reserva
async function release(productId, orderId, authorization) {
  const { data } = await call({
    method: 'POST',
    path: `/api/stock/${encodeURIComponent(productId)}/release`,
    authorization,
    body: { orderId },
    notFoundMessage: `No existe una reserva de la orden ${orderId} para el producto ${productId}`,
  });
  return data;
}

module.exports = { reserve, release };
