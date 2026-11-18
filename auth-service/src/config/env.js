require('dotenv').config({ quiet: true });

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : String(value).trim().toLowerCase() === 'true';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// El secreto JWT es configuración del entorno: nunca va en el código ni en Git.
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32 || jwtSecret.startsWith('CAMBIAR')) {
  throw new Error(
    'JWT_SECRET es obligatorio: debe tener al menos 32 caracteres y no puede ser el valor de ejemplo (ver .env.example)',
  );
}

const config = {
  serviceName: process.env.SERVICE_NAME || 'auth-service',
  env: process.env.NODE_ENV || 'development',

  // Puerto HTTP (interno / red Docker) y HTTPS (acceso externo)
  port: toInt(process.env.PORT, 3004),
  https: {
    enabled: toBool(process.env.HTTPS_ENABLED, false),
    port: toInt(process.env.HTTPS_PORT, 4004),
    keyPath: process.env.SSL_KEY_PATH || '../certs/server.key',
    certPath: process.env.SSL_CERT_PATH || '../certs/server.crt',
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/auth_db',
    retryMs: toInt(process.env.MONGO_RETRY_MS, 3000),
    maxRetries: toInt(process.env.MONGO_MAX_RETRIES, 10),
  },

  jwt: {
    secret: jwtSecret,
    algorithm: 'HS256', // firma simétrica; se fija explícitamente al firmar y al verificar
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
  },

  bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),

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