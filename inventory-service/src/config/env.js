require('dotenv').config({ quiet: true });

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : String(value).trim().toLowerCase() === 'true';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const stripSlash = (url) => (url ? url.replace(/\/+$/, '') : url);

// "id=url,id=url" -> { id: url }
const parseMap = (value, variableName) => {
  const entries = String(value || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean);
  const result = {};

  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`${variableName} debe tener el formato id=url,id=url`);
    }

    const id = entry.slice(0, separator).trim();
    const url = stripSlash(entry.slice(separator + 1).trim());
    if (!id || !url || Object.prototype.hasOwnProperty.call(result, id)) {
      throw new Error(`${variableName} contiene un nodo inválido o duplicado`);
    }
    result[id] = url;
  }

  return result;
};

function buildRaftConfig() {
  const enabled = toBool(process.env.RAFT_ENABLED, false);
  const nodeId = process.env.NODE_ID || process.env.SERVICE_NAME || 'inventory-service';
  const peerMap = parseMap(process.env.RAFT_PEERS, 'RAFT_PEERS');
  const publicUrls = parseMap(process.env.RAFT_PUBLIC_URLS, 'RAFT_PUBLIC_URLS');
  const token = process.env.RAFT_TOKEN || '';

  if (enabled) {
    if (Object.keys(peerMap).length !== 3) {
      throw new Error('RAFT_PEERS debe definir exactamente los 3 nodos del cluster');
    }
    if (!peerMap[nodeId]) {
      throw new Error(`RAFT_PEERS tiene que incluir a este nodo (NODE_ID=${nodeId}): id=http://host:puerto,...`);
    }
    if (token.length < 16 || /^cambiar/i.test(token)) {
      throw new Error(
        'RAFT_TOKEN es obligatorio con Raft activo (mínimo 16 caracteres, distinto del valor de ejemplo e igual en los 3 nodos)',
      );
    }
    if (token === jwtSecret) {
      throw new Error('RAFT_TOKEN debe ser distinto de JWT_SECRET');
    }
  }

  return {
    enabled,
    nodeId,
    peers: Object.entries(peerMap).map(([id, url]) => ({ id, url })),
    publicUrls,
    token,
    rpcTimeoutMs: toInt(process.env.RAFT_RPC_TIMEOUT_MS, 800),
    timing: {
      heartbeatMs: toInt(process.env.RAFT_HEARTBEAT_MS, 300),
      electionMinMs: toInt(process.env.RAFT_ELECTION_MIN_MS, 1200),
      electionMaxMs: toInt(process.env.RAFT_ELECTION_MAX_MS, 2400),
      proposeTimeoutMs: toInt(process.env.RAFT_PROPOSE_TIMEOUT_MS, 3000),
    },
  };
}

// El secreto JWT es configuración del entorno: nunca va en el código ni en Git.
// Tiene que ser el MISMO que usa auth-service para firmar.
const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32 || /^cambiar/i.test(jwtSecret)) {
  throw new Error(
    'JWT_SECRET es obligatorio: debe tener al menos 32 caracteres, ser el mismo que el de ' +
      'auth-service y no puede ser el valor de ejemplo (ver .env.example)',
  );
}

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

  raft: buildRaftConfig(),

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

  jwt: {
    secret: jwtSecret,
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
  },

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
