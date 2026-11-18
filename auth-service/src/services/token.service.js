const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Claims: sub (id del usuario), role, iat, exp (automáticos) e iss.
// Nunca se incluyen contraseñas, hashes ni secretos.
function signAccessToken(user) {
  const token = jwt.sign({ role: user.role }, config.jwt.secret, {
    algorithm: config.jwt.algorithm,
    subject: user.id,
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
  });
  const { iat, exp } = jwt.decode(token);
  return { token, expiresIn: exp - iat };
}

// Solo se aceptan tokens HS256 firmados con el secreto configurado y del emisor esperado.
// Rechaza tokens sin firma ("alg: none"), con otro algoritmo, alterados o vencidos.
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: [config.jwt.algorithm],
    issuer: config.jwt.issuer,
  });
}

module.exports = { signAccessToken, verifyAccessToken };