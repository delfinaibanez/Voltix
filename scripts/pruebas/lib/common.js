'use strict';
/**
 * Utilidades compartidas por los scripts de pruebas (solo Node nativo, sin dependencias).
 * Configuración por variables de entorno (todas opcionales, ver `cfg`).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Carga opcional de variables desde un .env (solo las claves indicadas).
function loadEnvFile(file, onlyKeys) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      if (onlyKeys && !onlyKeys.includes(m[1])) continue;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* archivo opcional */ }
}
loadEnvFile(path.join(ROOT, 'scripts', 'pruebas', '.env'));
loadEnvFile(path.join(ROOT, 'orders-service', '.env'), ['JWT_SECRET']);

const strip = (u) => u.replace(/\/+$/, '');
const cfg = {
  catalog: strip(process.env.CATALOG_URL || 'http://localhost:3001'),
  inventory: strip((process.env.INVENTORY_URL || 'http://localhost:3002').split(',')[0].trim()),
  orders: strip(process.env.ORDERS_URL || 'http://localhost:3003'),
  auth: strip(process.env.AUTH_URL || 'http://localhost:3004'),
  jwtSecret: process.env.JWT_SECRET,
  issuer: process.env.JWT_ISSUER || 'voltix-auth-service',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  registerPath: process.env.AUTH_REGISTER_PATH || '/auth/register',
  loginPath: process.env.AUTH_LOGIN_PATH || '/auth/login',
  // Nombres de servicio en docker-compose.yml
  compose: {
    catalog: process.env.SVC_CATALOG || 'catalog-service',
    inventory: process.env.SVC_INVENTORY || 'inventory-service',
    orders: process.env.SVC_ORDERS || 'orders-service',
    auth: process.env.SVC_AUTH || 'auth-service',
    authDb: process.env.SVC_AUTH_DB || 'auth-db',
  },
  authDbName: process.env.AUTH_DB_NAME || 'auth_db',
  usersCollection: process.env.USERS_COLLECTION || 'users',
  authMongoUri: process.env.AUTH_MONGODB_URI || 'mongodb://127.0.0.1:27017/auth_db',
};

const SIN_DOCKER = process.argv.includes('--sin-docker');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP ----------
async function call(base, method, p, { token, body, headers } = {}) {
  try {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* no JSON */ }
    return { status: res.status, body: json, text };
  } catch (e) {
    return { status: 0, body: null, text: '', error: e.cause?.code || e.message };
  }
}

// ---------- JWT (HS256 con crypto, solo para armar tokens de prueba) ----------
const b64u = (v) => Buffer.from(v).toString('base64url');

function signJwt(payload, { secret = cfg.jwtSecret, iat, expiresIn = 3600 } = {}) {
  const now = iat ?? Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: cfg.issuer, ...payload, iat: now, exp: now + expiresIn }));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
function unsignedJwt(payload) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: cfg.issuer, ...payload, iat: now, exp: now + 3600 }))}.`;
}
function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}
// Cambia el payload y conserva la firma original (debe ser rechazado).
function tamperJwt(token, changes) {
  const [h, , s] = token.split('.');
  return `${h}.${b64u(JSON.stringify({ ...decodeJwt(token), ...changes }))}.${s}`;
}

// ---------- Auth ----------
// Si auth-service exige otros campos, ajustar SOLO esta función.
const registerBody = (email, password) => ({ email, password, name: 'Usuario Prueba' });
const loginBody = (email, password) => ({ email, password });
const extractToken = (b) => b && (b.accessToken || b.token || b.access_token || b.data?.accessToken || b.data?.token);

async function registerAndLogin(email, password) {
  const reg = await call(cfg.auth, 'POST', cfg.registerPath, { body: registerBody(email, password) });
  const login = await call(cfg.auth, 'POST', cfg.loginPath, { body: loginBody(email, password) });
  return { reg, login, token: extractToken(login.body) };
}
const leaksCredentials = (text, password) =>
  /"(password|passwordHash|password_hash)"\s*:/i.test(text) || (password && text.includes(password));

// ---------- Datos de catálogo / inventario ----------
function extractList(b) {
  if (Array.isArray(b)) return b;
  return b?.data || b?.items || b?.products || b?.docs || b?.results || [];
}
async function getProducts(n = 1) {
  const res = await call(cfg.catalog, 'GET', '/api/products?limit=20');
  return extractList(res.body)
    .filter((p) => p.active !== false)
    .slice(0, n)
    .map((p) => ({ ...p, id: p.id || p._id }));
}
async function stockOf(productId) {
  const res = await call(cfg.inventory, 'GET', `/api/stock/${productId}`);
  return res.status === 200 ? res.body : null;
}
const newId = () => crypto.randomBytes(12).toString('hex'); // 24 hex, válido como ObjectId
const ZERO_ID = '0'.repeat(24);

// ---------- Docker Compose ----------
function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 300000 });
}
function dockerRunning(service) {
  if (SIN_DOCKER) return false;
  try {
    return sh('docker compose ps --services --status running').split(/\r?\n/).map((s) => s.trim()).includes(service);
  } catch { return false; }
}
async function waitHealth(base, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await call(base, 'GET', '/health')).status === 200) return true;
    await sleep(2000);
  }
  return false;
}

// ---------- Reporte ----------
function createReporter(title) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  console.log(`\n=== ${title} ===\n`);
  return {
    check(id, desc, expected, actual, extraOk = true, note = '') {
      const exp = Array.isArray(expected) ? expected : [expected];
      const ok = exp.includes(actual) && extraOk;
      counts[ok ? 'PASS' : 'FAIL']++;
      const extra = exp.includes(actual) && !extraOk ? ` | condición no cumplida: ${note}` : '';
      console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${desc} — esperado ${exp.join(' o ')}, obtenido ${actual}${extra}`);
      return ok;
    },
    skip(id, desc, reason) {
      counts.SKIP++;
      console.log(`SKIP  [${id}] ${desc} — ${reason}`);
    },
    summary() {
      console.log(`\nResumen: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIP} SKIP`);
      if (counts.FAIL > 0) process.exitCode = 1;
    },
  };
}

module.exports = {
  ROOT, cfg, SIN_DOCKER, sleep, call, signJwt, unsignedJwt, decodeJwt, tamperJwt,
  registerBody, loginBody, extractToken, registerAndLogin, leaksCredentials,
  extractList, getProducts, stockOf, newId, ZERO_ID, sh, dockerRunning, waitHealth,
  createReporter, createRequire,
};
