const path = require('node:path');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const config = require('../config/env');

// Nunca se registran contraseñas, tokens ni secretos (TP3 / TP7).
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|jwt|api[-_]?key|cookie/i;
const RESERVED = new Set(['level', 'message', 'timestamp', 'service', 'stack']);

const redact = (value, depth = 0) => {
  if (value === null || typeof value !== 'object' || depth > 5) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(val, depth + 1),
    ]),
  );
};

const redactSecrets = format((info) => {
  for (const key of Object.keys(info)) {
    if (RESERVED.has(key)) continue;
    info[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(info[key]);
  }
  return info;
});

const baseFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  redactSecrets(),
);

const consoleFormat = format.combine(
  baseFormat,
  format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
    const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.toUpperCase()} [${service}] ${message}${extra}${stack ? `\n${stack}` : ''}`;
  }),
);

const fileFormat = format.combine(baseFormat, format.json());

// Todo sale por stdout/stderr (docker compose logs) y, opcionalmente, a archivos rotativos.
const logTransports = [
  new transports.Console({ format: consoleFormat, stderrLevels: ['error'] }),
];

if (config.log.toFiles) {
  const rotation = {
    dirname: path.resolve(config.log.dir),
    datePattern: config.log.datePattern,
    maxSize: config.log.maxSize, // rota por tamaño además de por fecha
    maxFiles: config.log.maxFiles, // retención: borra archivos más viejos
    zippedArchive: true,
    format: fileFormat,
  };
  logTransports.push(
    new transports.DailyRotateFile({ ...rotation, filename: 'app-%DATE%.log' }),
    new transports.DailyRotateFile({ ...rotation, filename: 'error-%DATE%.log', level: 'error' }),
  );
}

const logger = createLogger({
  level: config.log.level,
  defaultMeta: { service: config.serviceName },
  transports: logTransports,
});

module.exports = logger;