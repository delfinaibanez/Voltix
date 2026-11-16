const AppError = require('./appError');
const { CATEGORIES } = require('../models/product.model');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const ALLOWED_FIELDS = ['sku', 'name', 'description', 'category', 'brand', 'price', 'imageUrl', 'active'];
const REQUIRED_FIELDS = ['sku', 'name', 'category', 'price'];
const STRING_FIELDS = ['sku', 'name', 'description', 'category', 'brand', 'imageUrl'];

const isObjectId = (value) => typeof value === 'string' && OBJECT_ID_REGEX.test(value);

// Valida forma y tipos del body. Las reglas de dominio (rangos, enum, requeridos,
// unicidad) las aplica Mongoose en el schema, que es su única fuente.
function validateProductBody(body, { partial = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw AppError.badRequest('El body debe ser un objeto JSON');
  }

  const details = [];

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      details.push({ field: key, message: 'Campo no permitido' });
    }
  }

  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== 'string') {
      details.push({ field, message: `${field} debe ser un string` });
    }
  }

  if (body.price !== undefined && (typeof body.price !== 'number' || !Number.isFinite(body.price))) {
    details.push({ field: 'price', message: 'price debe ser un número' });
  }

  if (body.active !== undefined && typeof body.active !== 'boolean') {
    details.push({ field: 'active', message: 'active debe ser booleano' });
  }

  // En POST y PUT (reemplazo completo) los campos obligatorios no pueden omitirse.
  if (!partial) {
    for (const field of REQUIRED_FIELDS) {
      if (body[field] === undefined) {
        details.push({ field, message: `${field} es obligatorio` });
      }
    }
  }

  if (partial && Object.keys(body).length === 0) {
    details.push({ field: 'body', message: 'Debe enviar al menos un campo para modificar' });
  }

  if (details.length > 0) {
    throw AppError.badRequest('Datos inválidos', details);
  }

  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

// Valida y normaliza los parámetros de GET /api/products.
function parseListQuery(query) {
  const details = [];
  const result = { page: 1, limit: 20 };

  const parseInteger = (field, min, max) => {
    if (query[field] === undefined) return undefined;
    const value = Number(query[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      details.push({ field, message: `${field} debe ser un entero entre ${min} y ${max}` });
      return undefined;
    }
    return value;
  };

  const parsePrice = (field) => {
    if (query[field] === undefined) return undefined;
    const value = Number(query[field]);
    if (query[field] === '' || !Number.isFinite(value) || value < 0) {
      details.push({ field, message: `${field} debe ser un número mayor o igual a 0` });
      return undefined;
    }
    return value;
  };

  result.page = parseInteger('page', 1, 1_000_000) ?? 1;
  result.limit = parseInteger('limit', 1, 100) ?? 20;
  result.minPrice = parsePrice('minPrice');
  result.maxPrice = parsePrice('maxPrice');

  if (query.category !== undefined) {
    const category = String(query.category).toUpperCase();
    if (!CATEGORIES.includes(category)) {
      details.push({ field: 'category', message: `category debe ser una de: ${CATEGORIES.join(', ')}` });
    } else {
      result.category = category;
    }
  }

  if (query.active !== undefined) {
    if (query.active !== 'true' && query.active !== 'false') {
      details.push({ field: 'active', message: 'active debe ser true o false' });
    } else {
      result.active = query.active === 'true';
    }
  }

  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim() === '' || query.q.length > 100) {
      details.push({ field: 'q', message: 'q debe ser un texto de 1 a 100 caracteres' });
    } else {
      result.q = query.q.trim();
    }
  }

  if (
    result.minPrice !== undefined &&
    result.maxPrice !== undefined &&
    result.minPrice > result.maxPrice
  ) {
    details.push({ field: 'minPrice', message: 'minPrice no puede ser mayor que maxPrice' });
  }

  if (details.length > 0) {
    throw AppError.badRequest('Parámetros de consulta inválidos', details);
  }

  return result;
}

module.exports = { isObjectId, validateProductBody, parseListQuery };