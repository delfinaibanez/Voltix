const AppError = require('./appError');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const ORDER_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_QUANTITY = 10000;
const MAX_STOCK = 1_000_000;

const isObjectId = (value) => typeof value === 'string' && OBJECT_ID_REGEX.test(value);

function assertObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw AppError.badRequest('El body debe ser un objeto JSON');
  }
}

function rejectExtraFields(body, allowed, details) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) details.push({ field: key, message: 'Campo no permitido' });
  }
}

function checkOrderId(body, details) {
  if (typeof body.orderId !== 'string' || !ORDER_ID_REGEX.test(body.orderId)) {
    details.push({
      field: 'orderId',
      message: 'orderId es obligatorio: 1 a 64 caracteres (letras, números, guiones o guion bajo)',
    });
  }
}

// PUT /api/stock/:productId -> { available }
function validateSetStockBody(body) {
  assertObject(body);
  const details = [];
  rejectExtraFields(body, ['available'], details);
  if (!Number.isInteger(body.available) || body.available < 0 || body.available > MAX_STOCK) {
    details.push({ field: 'available', message: `available debe ser un entero entre 0 y ${MAX_STOCK}` });
  }
  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);
  return { available: body.available };
}

// POST /api/stock/:productId/reserve -> { orderId, quantity }
function validateReserveBody(body) {
  assertObject(body);
  const details = [];
  rejectExtraFields(body, ['orderId', 'quantity'], details);
  checkOrderId(body, details);
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > MAX_QUANTITY) {
    details.push({ field: 'quantity', message: `quantity debe ser un entero entre 1 y ${MAX_QUANTITY}` });
  }
  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);
  return { orderId: body.orderId, quantity: body.quantity };
}

// POST /api/stock/:productId/release -> { orderId }
function validateReleaseBody(body) {
  assertObject(body);
  const details = [];
  rejectExtraFields(body, ['orderId'], details);
  checkOrderId(body, details);
  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);
  return { orderId: body.orderId };
}

module.exports = {
  isObjectId,
  validateSetStockBody,
  validateReserveBody,
  validateReleaseBody,
  MAX_QUANTITY,
  MAX_STOCK,
};
