// Exclusión mutua distribuida con Redis (TP2).
//
// Adquirir:  SET lock:stock:<productId> <token> NX PX <ttl>
//   - NX: solo se setea si la clave no existe -> un único dueño a la vez.
//   - PX: la clave vence sola; si el dueño se cae, el lock no queda tomado para siempre.
//   - token: UUID aleatorio que identifica al dueño de ESTE lock.
// Liberar: script Lua que borra la clave solo si todavía contiene nuestro token.
//   Es atómico en Redis, así que no se puede borrar el lock de otro proceso
//   (por ejemplo, si el nuestro venció y otro ya lo tomó).
//
// Granularidad por producto: cada productId tiene su propia clave, así que
// reservas de productos distintos no se bloquean entre sí.

const crypto = require('node:crypto');
const config = require('../config/env');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { client } = require('../config/redis');

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lockKey = (productId) => `lock:stock:${productId}`;

const retryAfterSeconds = () => Math.max(1, Math.ceil(config.lock.waitMs / 1000));

function redisUnavailable(err) {
  logger.warn('No se pudo usar el lock: Redis no disponible', { reason: err.message });
  return AppError.serviceUnavailable(
    'Servicio de locks no disponible (Redis). Intentá de nuevo en unos segundos.',
    retryAfterSeconds(),
  );
}

async function acquire(key) {
  if (!client.isReady) throw redisUnavailable(new Error('cliente Redis no conectado'));

  const token = crypto.randomUUID();
  const deadline = Date.now() + config.lock.waitMs;

  for (let attempt = 1; ; attempt += 1) {
    let result;
    try {
      result = await client.set(key, token, { NX: true, PX: config.lock.ttlMs });
    } catch (err) {
      throw redisUnavailable(err);
    }

    if (result === 'OK') {
      if (attempt > 1) logger.debug('Lock adquirido tras reintentos', { key, attempt });
      return token;
    }

    if (Date.now() >= deadline) {
      logger.warn('Timeout esperando el lock', { key, waitMs: config.lock.waitMs, attempts: attempt });
      throw AppError.serviceUnavailable(
        'El producto está siendo modificado por otra operación. Reintentá en unos segundos.',
        retryAfterSeconds(),
      );
    }

    // Espera con un poco de azar para que los que compiten no reintenten todos juntos.
    await sleep(config.lock.retryMs + Math.floor(Math.random() * config.lock.retryMs));
  }
}

async function release(key, token) {
  try {
    const deleted = await client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
    if (deleted !== 1) {
      // El lock venció (TTL) antes de terminar: otro pudo haber entrado.
      logger.warn('El lock ya había vencido al liberarlo; revisar LOCK_TTL_MS', { key });
    }
  } catch (err) {
    // Si Redis se cayó, el lock vence solo por TTL.
    logger.warn('No se pudo liberar el lock; vencerá por TTL', { key, reason: err.message });
  }
}

// Ejecuta fn() en exclusión mutua para un producto.
async function withProductLock(productId, fn) {
  const key = lockKey(productId);
  const token = await acquire(key);
  try {
    return await fn();
  } finally {
    await release(key, token);
  }
}

module.exports = { withProductLock, lockKey };
