const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const mongoose = require('mongoose');
const config = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { Stock } = require('./models/stock.model');
const { Reservation } = require('./models/reservation.model');
const raft = require('./raft');
const createApp = require('./app');

const servers = [];

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      logger.info(`${label} escuchando`, { port });
      resolve();
    });
  });
}

function loadCertificate() {
  const keyPath = path.resolve(config.https.keyPath);
  const certPath = path.resolve(config.https.certPath);
  try {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (err) {
    throw new Error(
      `No se pudo leer el certificado HTTPS (${keyPath}, ${certPath}). ` +
        `Generalo con scripts/gen-certs.ps1 o desactivá HTTPS_ENABLED. Causa: ${err.message}`,
    );
  }
}

function logLockMode() {
  if (!config.lock.enabled) {
    logger.warn('LOCK_ENABLED=false: escrituras SIN exclusión mutua (solo para la demo de carrera)');
  } else {
    logger.info('Lock distribuido activo', {
      ttlMs: config.lock.ttlMs,
      waitMs: config.lock.waitMs,
    });
    if (config.demoDelayMs >= config.lock.ttlMs) {
      logger.warn('DEMO_DELAY_MS >= LOCK_TTL_MS: el lock vencería dentro de la sección crítica');
    }
  }
  if (config.demoDelayMs > 0) {
    logger.warn('DEMO_DELAY_MS activo: retardo artificial en la sección crítica', {
      demoDelayMs: config.demoDelayMs,
    });
  }
}

async function start() {
  await connectWithRetry();
  // Garantiza los índices únicos (productId y orderId+productId) antes de recibir tráfico.
  await Promise.all([Stock.init(), Reservation.init()]);

  if (config.lock.enabled) connectRedis();
  logLockMode();

  const app = createApp();

  const httpServer = http.createServer(app);
  servers.push(httpServer);
  await listen(httpServer, config.port, 'HTTP');

  if (config.https.enabled) {
    const httpsServer = https.createServer(loadCertificate(), app);
    servers.push(httpsServer);
    await listen(httpsServer, config.https.port, 'HTTPS');
  }

  // Raft arranca con los puertos ya abiertos: los otros nodos necesitan llegar a /raft.
  await raft.start();
}

async function shutdown(signal) {
  logger.info('Apagando servicio', { signal });
  await raft.stop();
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  await disconnectRedis();
  await mongoose.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error('No se pudo iniciar el servicio', { error: err.message });
  // Deja que Winston termine de escribir antes de salir.
  setTimeout(() => process.exit(1), 300);
});
