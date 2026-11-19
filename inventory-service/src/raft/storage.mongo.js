// Persistencia de Raft en la base Mongo propia de cada nodo (H6).
//   raft_state: un documento por nodo con currentTerm, votedFor y lastApplied.
//   raft_log:   una entrada por documento { nodeId, index, term, command }.
// Se escribe ANTES de responder cualquier RPC, así un reinicio completo del
// cluster no pierde votos, términos ni entradas.

const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    currentTerm: { type: Number, default: 0 },
    votedFor: { type: String, default: null },
    lastApplied: { type: Number, default: 0 },
  },
  { versionKey: false, collection: 'raft_state' },
);

const logSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true },
    index: { type: Number, required: true },
    term: { type: Number, required: true },
    command: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { versionKey: false, collection: 'raft_log' },
);
logSchema.index({ nodeId: 1, index: 1 }, { unique: true });

const RaftState = mongoose.models.RaftState || mongoose.model('RaftState', stateSchema);
const RaftLogEntry = mongoose.models.RaftLogEntry || mongoose.model('RaftLogEntry', logSchema);

function createMongoStorage(nodeId) {
  return {
    async load() {
      await RaftLogEntry.init();
      const [state, rows] = await Promise.all([
        RaftState.findById(nodeId).lean(),
        RaftLogEntry.find({ nodeId }).sort({ index: 1 }).lean(),
      ]);

      const entries = rows.map((row) => ({ index: row.index, term: row.term, command: row.command }));
      entries.forEach((entry, i) => {
        if (entry.index !== i + 1) {
          throw new Error(`El log de Raft está corrupto: falta la entrada ${i + 1} (se leyó ${entry.index})`);
        }
      });

      return {
        currentTerm: state ? state.currentTerm : 0,
        votedFor: state ? state.votedFor : null,
        lastApplied: state ? state.lastApplied : 0,
        entries,
      };
    },

    async saveState({ currentTerm, votedFor }) {
      await RaftState.updateOne({ _id: nodeId }, { $set: { currentTerm, votedFor } }, { upsert: true });
    },

    async saveLastApplied(index) {
      await RaftState.updateOne({ _id: nodeId }, { $set: { lastApplied: index } }, { upsert: true });
    },

    async appendEntries(entries) {
      await RaftLogEntry.bulkWrite(
        entries.map((entry) => ({
          replaceOne: {
            filter: { nodeId, index: entry.index },
            replacement: { nodeId, index: entry.index, term: entry.term, command: entry.command },
            upsert: true,
          },
        })),
      );
    },

    async truncateFrom(index) {
      await RaftLogEntry.deleteMany({ nodeId, index: { $gte: index } });
    },
  };
}

module.exports = { createMongoStorage };