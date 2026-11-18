const AppError = require('../utils/appError');
const logger = require('../utils/logger');

// Autorización por rol. Se usa DESPUÉS de authenticate.
// Identidad válida pero rol insuficiente -> 403.
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) throw new AppError(401, 'No hay una identidad autenticada');

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Acceso denegado por rol', {
        userId: req.user.id,
        role: req.user.role,
        endpoint: req.originalUrl.split('?')[0],
      });
      throw new AppError(403, 'No tenés permisos para realizar esta operación');
    }
    next();
  };
}

module.exports = authorize;