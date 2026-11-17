const { createClient } = require('redis');
const config = require('./env');
const logger = require('../utils/logger');

// Un único cliente Redis para todo el servicio (lo usa el lock distribuido).
const client = createClient({
  url: config.redis.url,
  // Si Redis está caído, los comandos fallan enseguida en lugar de quedar
  // encolados: así la request recibe 503 sin esperar.
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 3000,
    // Reintenta para siempre, con espera creciente hasta 3 s.
    reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
  },
});

let wasReady = false;

client.on('ready', () => {
  logger.info(wasReady ? 'Conexión con Redis restablecida' : 'Conectado a Redis');
  wasReady = true;
});

// Sin este listener, un error de conexión tiraría abajo el proceso.
let lastError = null;
client.on('error', (err) => {
  const reason = err.message || err.code || String(err);
  if (reason !== lastError) logger.warn('Redis no disponible', { reason });
  lastError = reason;
});
client.on('end', () => logger.info('Conexión con Redis cerrada'));

// No bloquea el arranque: si Redis no está, el servicio levanta igual y las
// escrituras responden 503 hasta que vuelva.
function connectRedis() {
  client.connect().catch((err) => logger.warn('No se pudo conectar a Redis', { reason: err.message }));
}

async function disconnectRedis() {
  if (client.isOpen) await client.quit().catch(() => client.destroy());
}

module.exports = { client, connectRedis, disconnectRedis };
