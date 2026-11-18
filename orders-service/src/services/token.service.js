const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Solo se aceptan tokens HS256 firmados con el secreto compartido y emitidos por auth-service.
// Rechaza tokens sin firma ("alg: none"), con otro algoritmo, alterados o vencidos.
// La firma se valida localmente: orders-service nunca consulta a auth-service.
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: [config.jwt.algorithm],
    issuer: config.jwt.issuer,
  });
}

module.exports = { verifyAccessToken };
