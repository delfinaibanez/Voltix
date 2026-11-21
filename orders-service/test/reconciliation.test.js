// Pruebas de la reconciliación de liberaciones de stock (TP6). Usan un almacén en memoria
// y un cliente de inventory simulado: no necesitan Mongo ni Docker.
//
//   cd orders-service && npm run test:reconciliation
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'a'.repeat(40);
process.env.SERVICE_CLIENT_SECRET = 'b'.repeat(40);
process.env.LOG_TO_FILES = 'false';
process.env.LOG_LEVEL = 'error';

const SRC = path.resolve(__dirname, '..', 'src');
const stub = (rel, exports) => {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

// --- almacén en memoria con la parte de la API de Mongoose que usa el servicio
let rows = [];
const matches = (row, f) => Object.entries(f).every(([k, v]) => (v && v.$lte ? row[k] <= v.$lte : row[k] === v));
stub('models/pendingRelease.model.js', {
  PendingRelease: {
    async findOneAndUpdate(f, u) {
      let row = rows.find((r) => matches(r, f));
      if (!row) {
        row = { _id: rows.length + 1, ...f, attempts: 0, ...u.$setOnInsert };
        rows.push(row);
      }
      Object.assign(row, u.$set);
      return row;
    },
    find(f) {
      const result = rows.filter((r) => matches(r, f));
      const chain = { sort: () => chain, limit: () => Promise.resolve(result) };
      return chain;
    },
    async deleteOne(f) { rows = rows.filter((r) => !matches(r, f)); },
    async updateOne(f, u) { Object.assign(rows.find((r) => matches(r, f)), u); },
    countDocuments: async () => rows.length,
  },
});

// --- inventory simulado: cada llamada puede salir bien o fallar
let releaseBehavior = () => Promise.resolve({ status: 'RELEASED' });
const releaseCalls = [];
stub('clients/inventory.client.js', {
  release: (productId, orderId) => { releaseCalls.push({ productId, orderId }); return releaseBehavior(); },
  reserve: async () => ({}),
});

const reconciliation = require(path.join(SRC, 'services/reconciliation.service.js'));
const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const makeDue = () => rows.forEach((r) => { r.nextAttemptAt = new Date(Date.now() - 1000); });

test('una liberación fallida se guarda y se reintenta hasta lograrla', async () => {
  rows = []; releaseCalls.length = 0;
  await reconciliation.enqueue({ orderId: 'o1', productId: 'p1', reason: 'create-failed', cause: 'inventory caído' });
  assert.equal(rows.length, 1);

  releaseBehavior = () => Promise.reject(failure(503, 'inventory-service no está disponible'));
  makeDue();
  assert.equal(await reconciliation.runOnce(), 0);
  assert.equal(rows.length, 1, 'sigue pendiente');
  assert.equal(rows[0].attempts, 1);
  assert.ok(rows[0].nextAttemptAt > new Date(), 'se reprograma para más adelante');

  releaseBehavior = () => Promise.resolve({ status: 'RELEASED' });
  makeDue();
  assert.equal(await reconciliation.runOnce(), 1);
  assert.equal(rows.length, 0, 'ya no queda pendiente');
});

test('si la reserva nunca existió (404) se da por resuelta', async () => {
  rows = [];
  await reconciliation.enqueue({ orderId: 'o2', productId: 'p1', reason: 'cancel', cause: 'x' });
  releaseBehavior = () => Promise.reject(failure(404, 'no existe la reserva'));
  makeDue();
  assert.equal(await reconciliation.runOnce(), 1);
  assert.equal(rows.length, 0);
});

test('registrar dos veces la misma liberación no duplica la fila', async () => {
  rows = [];
  await reconciliation.enqueue({ orderId: 'o3', productId: 'p1', reason: 'cancel', cause: 'x' });
  await reconciliation.enqueue({ orderId: 'o3', productId: 'p1', reason: 'cancel', cause: 'y' });
  assert.equal(rows.length, 1);
});

test('la espera crece (5 s, 10 s, 20 s...) y se frena en 5 minutos', () => {
  assert.deepEqual([1, 2, 3, 4].map(reconciliation.backoff), [5000, 10000, 20000, 40000]);
  assert.equal(reconciliation.backoff(50), 5 * 60 * 1000);
});
