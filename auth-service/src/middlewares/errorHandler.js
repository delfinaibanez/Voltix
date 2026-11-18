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
};

// Traduce cualquier error a una respuesta consistente.
// Nunca se devuelven stack traces, secretos ni detalles internos de librerías.
function toHttpError(err) {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, details: err.details };
  }

  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return { status: 400, message: 'Datos inválidos', details };
  }

  if (err.name === 'CastError') {
    return { status: 400, message: `Valor inválido para el campo ${err.path}` };
  }

  if (err.code === 11000) {
    return {
      status: 409,
      message: 'Ya existe un usuario con ese email',
      details: [{ field: 'email', message: 'Debe ser único' }],
    };
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

  const { status, message, details } = toHttpError(err);

  if (status >= 500) {
    logger.error('Error no controlado', {
      method: req.method,
      endpoint: req.originalUrl.split('?')[0],
      error: err.message,
      stack: err.stack,
    });
  }

  if (status === 401) res.set('WWW-Authenticate', 'Bearer');

  const body = { status, error: TITLES[status] || 'Error', message };
  if (details) body.details = details;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler, toHttpError };