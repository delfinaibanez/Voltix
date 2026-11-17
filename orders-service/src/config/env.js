require('dotenv').config({ quiet: true });

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : String(value).trim().toLowerCase() === 'true';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const stripSlash = (url) => (url ? url.trim().replace(/\/+$/, '') : url);

// "http://a:3002, http://b:3002" -> ['http://a:3002', 'http://b:3002']
const toUrlList = (value) =>
  (value || '')
    .split(',')
    .map(stripSlash)
    .filter(Boolean);

const config = {
  serviceName: process.env.SERVICE_NAME || 'orders-service',
  env: process.env.NODE_ENV || 'development',

  // Puerto HTTP (interno / red Docker) y HTTPS (acceso externo)
  port: toInt(process.env.PORT, 3003),
  https: {
    enabled: toBool(process.env.HTTPS_ENABLED, false),
    port: toInt(process.env.HTTPS_PORT, 4003),
    keyPath: process.env.SSL_KEY_PATH || '../certs/server.key',
    certPath: process.env.SSL_CERT_PATH || '../certs/server.crt',
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/orders_db',
    retryMs: toInt(process.env.MONGO_RETRY_MS, 3000),
    maxRetries: toInt(process.env.MONGO_MAX_RETRIES, 10),
  },

  // Nunca localhost fijo: las URLs salen siempre del entorno.
  services: {
    catalogUrls: toUrlList(process.env.CATALOG_SERVICE_URL),
    inventoryUrls: toUrlList(process.env.INVENTORY_SERVICE_URL),
    timeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 3000),
  },

  // HS256 con secreto compartido; issuer fijo del contrato.
  jwt: {
    secret: process.env.JWT_SECRET,
    issuer: 'voltix-auth-service',
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
