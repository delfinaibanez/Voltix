const config = require('../config/env');
const logger = require('../utils/logger');
const inventory = require('../clients/inventory.client');
const { PendingRelease } = require('../models/pendingRelease.model');

// Reconciliación automática de liberaciones de stock (TP6).
//
// Si al compensar (o cancelar) una orden la liberación falla, se registra acá en vez de
// dejar la reserva colgada esperando una intervención manual. Un proceso periódico
// reintenta con espera creciente (5 s, 10 s, 20 s... hasta 5 min) y no se rinde nunca:
// liberar es idempotente en inventory, así que reintentar es seguro.

const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 5 * 60 * 1000;

const backoff = (attempts) => Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);

// Registra (o actualiza) una liberación pendiente. Nunca lanza: es parte de la compensación.
async function enqueue({ orderId, productId, reason, cause }) {
  try {
    await PendingRelease.findOneAndUpdate(
      { orderId, productId },
      {
        $setOnInsert: { reason, nextAttemptAt: new Date(Date.now() + BASE_DELAY_MS) },
        $set: { lastError: String(cause || '').slice(0, 300) },
      },
      { upsert: true },
    );
    logger.warn('Liberación pendiente registrada para reconciliar', { orderId, productId, reason });
  } catch (err) {
    logger.error('No se pudo registrar la liberación pendiente', { orderId, productId, cause: err.message });
  }
}

// Un ciclo: reintenta las liberaciones vencidas. Devuelve cuántas se resolvieron.
async function runOnce() {
  const due = await PendingRelease.find({ nextAttemptAt: { $lte: new Date() } })
    .sort({ nextAttemptAt: 1 })
    .limit(config.reconciliation.batchSize);

  let resolved = 0;
  for (const item of due) {
    try {
      await inventory.release(item.productId, item.orderId);
      await PendingRelease.deleteOne({ _id: item._id });
      resolved += 1;
      logger.info('Reserva liberada por reconciliación', {
        orderId: item.orderId,
        productId: item.productId,
        intentos: item.attempts + 1,
      });
    } catch (err) {
      if (err.statusCode === 404) {
        // Nunca llegó a reservarse: no hay nada que liberar.
        await PendingRelease.deleteOne({ _id: item._id });
        resolved += 1;
        continue;
      }
      const attempts = item.attempts + 1;
      await PendingRelease.updateOne(
        { _id: item._id },
        { attempts, lastError: String(err.message).slice(0, 300), nextAttemptAt: new Date(Date.now() + backoff(attempts)) },
      );
      if (attempts % 10 === 0) {
        logger.error('Reconciliación: la liberación sigue fallando', {
          orderId: item.orderId, productId: item.productId, attempts, cause: err.message,
        });
      }
    }
  }
  return resolved;
}

let timer = null;
let running = false;

function start() {
  if (timer || !config.reconciliation.enabled) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (err) {
      logger.error('Falló un ciclo de reconciliación', { cause: err.message });
    } finally {
      running = false;
    }
  }, config.reconciliation.intervalMs);
  timer.unref();
  logger.info('Reconciliación de liberaciones iniciada', { intervalMs: config.reconciliation.intervalMs });
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

const pendingCount = () => PendingRelease.countDocuments();

module.exports = { enqueue, runOnce, start, stop, pendingCount, backoff };
