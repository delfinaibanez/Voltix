const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { verifyAccessToken } = require('../services/token.service');

const VALID_ROLES = ['USER', 'ADMIN', 'SERVICE'];

// Exige Authorization: Bearer <token>. Sin token, mal formado, firma inválida
// o vencido -> 401. Si es válido deja la identidad en req.user.
function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    throw new AppError(401, 'Falta el token de acceso (Authorization: Bearer <token>)');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    // Se registra el motivo técnico (sin el token); al cliente solo un mensaje genérico.
    logger.warn('Token rechazado', { reason: err.name, endpoint: req.originalUrl.split('?')[0] });
    throw new AppError(401, err.name === 'TokenExpiredError' ? 'Token vencido' : 'Token inválido');
  }

  if (!payload.sub || !VALID_ROLES.includes(payload.role)) {
    logger.warn('Token rechazado', { reason: 'claims_invalidos' });
    throw new AppError(401, 'Token inválido');
  }

  req.user = { id: payload.sub, role: payload.role };
  next();
}

module.exports = authenticate;