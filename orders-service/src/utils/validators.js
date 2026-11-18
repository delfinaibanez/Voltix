const AppError = require('./appError');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const MAX_ITEMS = 50;
const MAX_QUANTITY = 10000;
const MAX_LIMIT = 100;

const isObjectId = (value) => typeof value === 'string' && OBJECT_ID_REGEX.test(value);

// POST /api/orders -> { items: [{ productId, quantity }] }
// userId, precios y status NO se aceptan: salen del token y del catálogo.
function validateCreateOrderBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw AppError.badRequest('El body debe ser un objeto JSON');
  }

  const details = [];
  for (const key of Object.keys(body)) {
    if (key !== 'items') details.push({ field: key, message: 'Campo no permitido' });
  }

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    details.push({ field: 'items', message: `items debe ser un arreglo de 1 a ${MAX_ITEMS} elementos` });
  } else {
    const seen = new Set();
    body.items.forEach((item, index) => {
      const at = `items[${index}]`;
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        details.push({ field: at, message: 'Cada ítem debe ser un objeto' });
        return;
      }
      for (const key of Object.keys(item)) {
        if (key !== 'productId' && key !== 'quantity') {
          details.push({ field: `${at}.${key}`, message: 'Campo no permitido' });
        }
      }
      if (!isObjectId(item.productId)) {
        details.push({ field: `${at}.productId`, message: 'Debe ser un ObjectId de 24 caracteres hexadecimales' });
      } else if (seen.has(item.productId)) {
        details.push({ field: `${at}.productId`, message: 'Producto repetido: sumá las cantidades en un solo ítem' });
      } else {
        seen.add(item.productId);
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
        details.push({ field: `${at}.quantity`, message: `quantity debe ser un entero entre 1 y ${MAX_QUANTITY}` });
      }
    });
  }

  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);
  return { items: body.items.map(({ productId, quantity }) => ({ productId, quantity })) };
}

// GET /api/orders?page=1&limit=20
function parseListQuery(query) {
  const details = [];
  const read = (name, fallback, max) => {
    if (query[name] === undefined) return fallback;
    const value = Number(query[name]);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      details.push({ field: name, message: `${name} debe ser un entero entre 1 y ${max}` });
    }
    return value;
  };
  const page = read('page', 1, Number.MAX_SAFE_INTEGER);
  const limit = read('limit', 20, MAX_LIMIT);
  if (details.length > 0) throw AppError.badRequest('Parámetros de consulta inválidos', details);
  return { page, limit };
}

module.exports = { isObjectId, validateCreateOrderBody, parseListQuery };
