require('dotenv').config({ quiet: true });

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : String(value).trim().toLowerCase() === 'true';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// El secreto JWT es configuración del entorno: nunca va en el código ni en Git.
// Tiene que ser el MISMO que usa auth-service para firmar. Si falta, no arranca.
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32 || /^cambiar/i.test(jwtSecret)) {
  throw new Error(
    'JWT_SECRET es obligatorio: debe tener al menos 32 caracteres, ser el mismo que el de ' +
      'auth-service y no puede ser el valor de ejemplo (ver .env.example)',
  );
}

const config = {
  serviceName: process.env.SERVICE_NAME || 'catalog-service',
  env: process.env.NODE_ENV || 'development',

  // Puerto HTTP (interno / red Docker) y HTTPS (acceso externo)
  port: toInt(process.env.PORT, 3001),
  https: {
    enabled: toBool(process.env.HTTPS_ENABLED, false),
    port: toInt(process.env.HTTPS_PORT, 4001),
    keyPath: process.env.SSL_KEY_PATH || '../certs/server.key',
    certPath: process.env.SSL_CERT_PATH || '../certs/server.crt',
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/catalog_db',
    retryMs: toInt(process.env.MONGO_RETRY_MS, 3000),
    maxRetries: toInt(process.env.MONGO_MAX_RETRIES, 10),
  },

  // HS256 con el MISMO secreto que auth-service; el token se valida localmente.
  jwt: {
    secret: jwtSecret,
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
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