const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mongo puede tardar en estar disponible (sobre todo en Docker): se reintenta
// antes de rendirse, en lugar de asumir que la dependencia ya está lista.
async function connectWithRetry() {
  const { uri, retryMs, maxRetries } = config.mongo;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      logger.info('Conectado a MongoDB', { database: mongoose.connection.name });
      return;
    } catch (err) {
      logger.warn(`MongoDB no disponible (intento ${attempt}/${maxRetries})`, { reason: err.message });
      if (attempt >= maxRetries) throw err;
      await sleep(retryMs);
    }
  }
}

// Solo avisa de una desconexión si antes hubo una conexión establecida.
mongoose.connection.on('connected', () => {
  mongoose.connection.wasConnected = true;
});
mongoose.connection.on('disconnected', () => {
  if (mongoose.connection.wasConnected) logger.warn('Conexión con MongoDB perdida');
});
mongoose.connection.on('reconnected', () => logger.info('Conexión con MongoDB restablecida'));

module.exports = { connectWithRetry };