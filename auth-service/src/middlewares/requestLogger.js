const logger = require('../utils/logger');

// Registra cada request al terminar: INFO (2xx/3xx), WARN (4xx) o ERROR (5xx).
function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const meta = {
      method: req.method,
      endpoint: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };

    if (req.originalUrl === '/health') {
      logger.debug('request', meta); // no llenar los logs con los healthchecks
    } else if (res.statusCode >= 500) {
      logger.error('request', meta);
    } else if (res.statusCode >= 400) {
      logger.warn('request', meta);
    } else {
      logger.info('request', meta);
    }
  });

  next();
}

module.exports = requestLogger;