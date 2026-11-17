require('dotenv').config({ quiet: true });

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : String(value).trim().toLowerCase() === 'true';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const stripSlash = (url) => (url ? url.replace(/\/+$/, '') : url);

const config = {
  serviceName: process.env.SERVICE_NAME || 'inventory-service',
  env: process.env.NODE_ENV || 'development',

  // Puerto HTTP (interno / red Docker) y HTTPS (acceso externo)
  port: toInt(process.env.PORT, 3002),
  https: {
    enabled: toBool(process.env.HTTPS_ENABLED, false),
    port: toInt(process.env.HTTPS_PORT, 4002),
    keyPath: process.env.SSL_KEY_PATH || '../certs/server.key',
    certPath: process.env.SSL_CERT_PATH || '../certs/server.crt',
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inventory_db',
    retryMs: toInt(process.env.MONGO_RETRY_MS, 3000),
    maxRetries: toInt(process.env.MONGO_MAX_RETRIES, 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  },

  // Exclusión mutua distribuida (TP2)
  lock: {
    // false solo para reproducir la condición de carrera (scripts/race-demo.js).
    enabled: toBool(process.env.LOCK_ENABLED, true),
    // TTL del lock. Tiene que ser bastante mayor que lo que dura la sección
    // crítica (leer el stock + escribir stock y reserva en Mongo: decenas de ms),
    // para que no venza mientras el dueño todavía está trabajando. Pero no puede
    // ser muy largo: si el proceso se cae con el lock tomado, nadie lo libera y
    // el producto queda bloqueado hasta que venza. 5 s cubre la sección crítica
    // con mucho margen y acota ese bloqueo a 5 s como máximo.
    ttlMs: toInt(process.env.LOCK_TTL_MS, 5000),
    // Cuánto espera una request para conseguir el lock antes de responder 503.
    waitMs: toInt(process.env.LOCK_WAIT_MS, 3000),
    // Pausa entre reintentos de SET NX (se le suma un poco de azar).
    retryMs: toInt(process.env.LOCK_RETRY_MS, 50),
  },

  // Retardo artificial dentro de la sección crítica, para hacer visible la
  // condición de carrera. En uso normal debe quedar en 0.
  demoDelayMs: toInt(process.env.DEMO_DELAY_MS, 0),

  services: {
    catalogUrl: stripSlash(process.env.CATALOG_SERVICE_URL),
    timeoutMs: toInt(process.env.HTTP_CLIENT_TIMEOUT_MS, 5000),
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    toFiles: toBool(process.env.LOG_TO_FILES, true),
    dir: process.env.LOG_DIR || 'logs',
    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
  },
};

module.exports = config;
