const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const mongoose = require('mongoose');
const config = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { User } = require('./models/user.model');
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

async function start() {
  await connectWithRetry();
  await User.init(); // garantiza el índice único de email antes de recibir tráfico

  const app = createApp();

  const httpServer = http.createServer(app);
  servers.push(httpServer);
  await listen(httpServer, config.port, 'HTTP');

  if (config.https.enabled) {
    const httpsServer = https.createServer(loadCertificate(), app);
    servers.push(httpsServer);
    await listen(httpsServer, config.https.port, 'HTTPS');
  }
}

async function shutdown(signal) {
  logger.info('Apagando servicio', { signal });
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
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