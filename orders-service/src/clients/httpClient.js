const config = require('../config/env');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');

const MAX_REDIRECTS = 3;
// Errores funcionales del servicio remoto que se propagan con su mismo status (TP6 15.2).
const PASS_THROUGH = new Set([400, 401, 403, 404, 409]);
// Último origen que respondió por dependencia (p. ej. el líder del cluster): se prueba primero.
const preferred = new Map();

function describeCause(err) {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return `timeout tras ${config.services.timeoutMs} ms`;
  }
  return (err.cause && err.cause.code) || err.message; // ECONNREFUSED, ENOTFOUND, EAI_AGAIN...
}

// Una llamada con timeout explícito. Los 307/308 se siguen a mano para reenviar
// método, body y Authorization al nodo que indica Location (el líder).
async function send(url, { method, headers, payload }) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(config.services.timeoutMs),
    });

    const location = res.headers.get('location');
    if ((res.status === 307 || res.status === 308) && location) {
      await res.arrayBuffer().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    return { status: res.status, text: await res.text(), url: current };
  }
  throw new Error('demasiadas redirecciones');
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function handleResponse({ dependency, method, path, status, text, notFoundMessage }) {
  const data = parseJson(text);
  if (status >= 200 && status < 300) {
    if (status !== 204 && data === null) {
      throw AppError.badGateway(`${dependency} devolvió una respuesta que no es JSON`, dependency);
    }
    return { status, data };
  }

  logger[status >= 500 ? 'error' : 'warn']('Respuesta no exitosa de dependencia', {
    dependency,
    method,
    endpoint: path,
    status,
  });

  if (PASS_THROUGH.has(status)) {
    const message =
      status === 404 && notFoundMessage
        ? notFoundMessage
        : (data && data.message) || `${dependency} respondió ${status}`;
    const err = new AppError(status, message, data && data.details);
    err.dependency = dependency;
    throw err;
  }
  throw AppError.badGateway(`${dependency} respondió ${status}`, dependency);
}

// Llama a `dependency` probando sus URLs en orden. Sin respuesta (red, DNS, timeout)
// o con 503 se pasa a la siguiente; si ninguna sirve -> 503 nombrando la dependencia.
async function callService({ dependency, baseUrls, method = 'GET', path, authorization, body, notFoundMessage }) {
  if (baseUrls.length === 0) throw new Error(`Falta configurar la URL de ${dependency}`);

  const headers = { Accept: 'application/json' };
  if (authorization) headers.Authorization = authorization;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const candidates = [...new Set([preferred.get(dependency), ...baseUrls].filter(Boolean))];
  const failures = [];

  for (const base of candidates) {
    let result;
    try {
      result = await send(`${base}${path}`, { method, headers, payload });
    } catch (err) {
      const cause = describeCause(err);
      failures.push(cause);
      logger.warn('Dependencia sin respuesta', { dependency, method, endpoint: path, base, cause });
      continue;
    }

    if (result.status === 503) {
      failures.push('respondió 503');
      logger.warn('Dependencia no disponible', { dependency, method, endpoint: path, base, cause: '503' });
      continue;
    }

    preferred.set(dependency, new URL(result.url).origin);
    return handleResponse({ dependency, method, path, notFoundMessage, ...result });
  }

  throw AppError.serviceUnavailable(`${dependency} no está disponible (${failures.join('; ')})`, { dependency });
}

module.exports = { callService };
