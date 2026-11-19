const jwt = require('jsonwebtoken');
const config = require('../config/env');

// inventory-service solo VALIDA tokens; los emite auth-service.
// La firma se verifica localmente con el secreto compartido, sin consultar a auth.
// Solo se aceptan tokens HS256 del emisor esperado: rechaza "alg: none",
// otro algoritmo, tokens alterados o vencidos.
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: [config.jwt.algorithm],
    issuer: config.jwt.issuer,
  });
}

module.exports = { verifyAccessToken };
