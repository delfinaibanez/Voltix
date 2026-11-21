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

// El secreto JWT es configuración del entorno: nunca va en el código ni en Git.
// Si falta o es corto, el servicio no arranca.
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32 || jwtSecret.startsWith('CAMBIAR')) {
  throw new Error(
    'JWT_SECRET es obligatorio: debe tener al menos 32 caracteres y no puede ser el valor de ejemplo (ver .env.example)',
  );
}

// Identidad técnica de orders-service: con ella reserva y libera stock en inventory.
const serviceSecret = process.env.SERVICE_CLIENT_SECRET || '';
if (serviceSecret.length < 32) {
  throw new Error('SERVICE_CLIENT_SECRET es obligatorio (32+ caracteres, el mismo de SERVICE_CLIENTS en auth-service)');
}

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
    authUrls: toUrlList(process.env.AUTH_SERVICE_URL),
    timeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 2000),
    // Tras agotar todos los nodos de una dependencia, durante esta ventana (ms) las nuevas
    // llamadas fallan al instante con 503 (evita reintentar nodo por nodo en la compensación).
    failFastMs: toInt(process.env.DEPENDENCY_FAILFAST_MS, 2000),
  },

  // HS256 con el MISMO secreto que auth-service; el token se valida localmente.
  jwt: {
    secret: jwtSecret,
    algorithm: 'HS256', // se fija explícitamente al verificar
    issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
  },

  // Reconciliación de liberaciones de stock que fallaron (TP6).
  reconciliation: {
    enabled: toBool(process.env.RECONCILIATION_ENABLED, true),
    intervalMs: toInt(process.env.RECONCILIATION_INTERVAL_MS, 5000),
    batchSize: toInt(process.env.RECONCILIATION_BATCH_SIZE, 50),
  },

  serviceIdentity: {
    clientId: process.env.SERVICE_CLIENT_ID || 'orders-service',
    clientSecret: serviceSecret,
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
