const config = require('../config/env');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { callService } = require('./httpClient');

// Identidad técnica de orders-service. Le pide a auth-service un token con rol SERVICE
// (POST /auth/service-token) presentando su secreto, y lo reutiliza hasta poco antes de
// que venza. Así la emisión de credenciales sigue centralizada en Auth.
const RENEW_MARGIN_MS = 30 * 1000;

let cached = null; // { authorization, expiresAt }
let pending = null; // pedido en curso (evita pedir varios tokens a la vez)

async function fetchServiceToken() {
  const { clientId, clientSecret } = config.serviceIdentity;
  try {
    const { data } = await callService({
      dependency: 'auth-service',
      baseUrls: config.services.authUrls,
      method: 'POST',
      path: '/auth/service-token',
      body: { clientId, clientSecret },
    });
    cached = {
      authorization: `Bearer ${data.accessToken}`,
      expiresAt: Date.now() + data.expiresIn * 1000 - RENEW_MARGIN_MS,
    };
    logger.info('Token de servicio obtenido de auth-service', { clientId, expiresIn: data.expiresIn });
    return cached.authorization;
  } catch (err) {
    // Credenciales de servicio mal configuradas: es un problema nuestro, no del usuario.
    if (err.statusCode === 400 || err.statusCode === 401) {
      logger.error('auth-service rechazó las credenciales de orders-service', { status: err.statusCode });
      throw AppError.badGateway('No se pudo obtener la identidad de servicio', 'auth-service');
    }
    throw err;
  }
}

async function getServiceAuthorization() {
  if (cached && Date.now() < cached.expiresAt) return cached.authorization;
  if (!pending) pending = fetchServiceToken().finally(() => { pending = null; });
  return pending;
}

module.exports = { getServiceAuthorization };
