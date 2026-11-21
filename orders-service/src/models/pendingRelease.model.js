const mongoose = require('mongoose');

// Liberación de stock que no se pudo completar (inventory caído, sin quórum, timeout...).
// Se guarda en Mongo para que sobreviva a un reinicio de orders-service y un proceso
// de reconciliación la reintente hasta lograrla. Hay a lo sumo una por (orderId, productId).
const pendingReleaseSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    productId: { type: String, required: true },
    reason: { type: String, default: 'unknown' }, // create-failed | cancel
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    nextAttemptAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

pendingReleaseSchema.index({ orderId: 1, productId: 1 }, { unique: true });
pendingReleaseSchema.index({ nextAttemptAt: 1 });

const PendingRelease = mongoose.model('PendingRelease', pendingReleaseSchema);

module.exports = { PendingRelease };
