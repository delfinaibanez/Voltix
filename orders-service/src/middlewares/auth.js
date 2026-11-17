// TODO (TP7): reemplazar este archivo por los middlewares reales de
// auth-service/src/middlewares/ cuando auth-service esté en develop.
// Si el real deja la identidad en otra propiedad (no req.user = { id, role }),
// solo hay que adaptar src/utils/identity.js.
//
// Mientras tanto implementa el mismo contrato: JWT HS256 validado localmente con
// JWT_SECRET e issuer voltix-auth-service. 401 = sin identidad válida, 403 = rol insuficiente.

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const AppError = require('../utils/appError');

const ROLES = ['USER', 'ADMIN'];

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw AppError.unauthorized('Falta el token Bearer');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'], issuer: config.jwt.issuer });
  } catch (err) {
    throw AppError.unauthorized(err.name === 'TokenExpiredError' ? 'Token vencido' : 'Token inválido');
  }

  if (!payload.sub || !ROLES.includes(payload.role)) throw AppError.unauthorized('Token inválido');

  req.user = { id: String(payload.sub), role: payload.role };
  next();
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
}

module.exports = { authenticate, authorize };
