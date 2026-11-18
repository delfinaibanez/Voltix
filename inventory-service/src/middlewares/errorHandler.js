const logger = require('../utils/logger');
const AppError = require('../utils/appError');

function notFound(req, res, next) {
  next(AppError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

const TITLES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

// Traduce cualquier error (propio, de Mongoose, de Express) a una respuesta
// consistente. Nunca se devuelven stack traces ni detalles internos.
function toHttpError(err) {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, details: err.details, retryAfter: err.retryAfter };
  }

  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return { status: 400, message: 'Datos inválidos', details };
  }

  if (err.name === 'CastError') {
    return { status: 400, message: `Valor inválido para el campo ${err.path}` };
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    return {
      status: 409,
      message: `Ya existe un registro con ese valor de ${fields.join(', ') || 'campo'}`,
      details: fields.map((field) => ({ field, message: 'Debe ser único' })),
    };
  }

  // Mongo caído o sin respuesta durante la request.
  if (/^Mongo(Server)?(Selection|Network|NotConnected)/.test(err.name || '')) {
    return { status: 503, message: 'Base de datos no disponible', retryAfter: 5 };
  }

  if (err.type === 'entity.parse.failed') {
    return { status: 400, message: 'El body no es un JSON válido' };
  }

  if (err.type === 'entity.too.large') {
    return { status: 413, message: 'El body supera el tamaño máximo permitido' };
  }

  return { status: 500, message: 'Error interno del servidor' };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const { status, message, details, retryAfter } = toHttpError(err);

  if (status >= 500) {
    logger.error(status === 503 ? 'Dependencia no disponible' : 'Error no controlado', {
      method: req.method,
      endpoint: req.originalUrl.split('?')[0],
      error: err.message,
      stack: status === 503 ? undefined : err.stack,
    });
  }

  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  if (retryAfter) res.set('Retry-After', String(retryAfter));

  const body = { status, error: TITLES[status] || 'Error', message };
  if (details) body.details = details;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler, toHttpError };
