// TODO (TP7): reemplazar este archivo por los middlewares reales de
// auth-service/src/middlewares/ cuando auth-service esté en develop.
// Los reales validan el JWT localmente (HS256, JWT_SECRET, issuer
// voltix-auth-service) y responden 401 (authenticate) o 403 (authorize).
//
// Mientras tanto dejan pasar todas las requests, para poder probar el servicio.
// Las rutas ya los usan, así que el cambio es solo reemplazar este archivo.

const logger = require('../utils/logger');

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  logger.warn('Autenticación JWT pendiente: authenticate/authorize dejan pasar todo (TODO TP7)');
}

function authenticate(req, res, next) {
  warnOnce();
  next();
}

// eslint-disable-next-line no-unused-vars
function authorize(...roles) {
  return (req, res, next) => {
    warnOnce();
    next();
  };
}

module.exports = { authenticate, authorize };
