// Punto de entrada de Raft dentro de inventory-service.
//
// Con RAFT_ENABLED=true toda escritura de stock pasa por el cluster:
//   líder:    toma el lock de Redis -> propose() -> commit por mayoría -> aplica
//   follower: rechaza la escritura e informa quién es el líder
// Con RAFT_ENABLED=false el servicio funciona como un nodo único (solo lock de Redis).
//
// Redis NO se usa para elegir líder ni para el commit: el lock decide quién entra
// a la sección crítica de un producto; Raft ordena y confirma las escrituras.

const config = require('../config/env');
const logger = require('../utils/logger');
const { applyCommand } = require('../services/stock.commands');
const { RaftNode, NotLeaderError } = require('./node');
const { createHttpTransport } = require('./transport');
const { createMongoStorage } = require('./storage.mongo');
const { notLeader } = require('./errors');

let node = null;

const isEnabled = () => config.raft.enabled;
const getNode = () => node;

async function start() {
  if (!isEnabled() || node) return;
  const { nodeId, peers, token, rpcTimeoutMs, timing } = config.raft;

  node = new RaftNode({
    id: nodeId,
    peers,
    storage: createMongoStorage(nodeId),
    transport: createHttpTransport({ token, timeoutMs: rpcTimeoutMs }),
    apply: applyCommand,
    logger,
    options: timing,
  });
  await node.start();
}

async function stop() {
  if (node) await node.stop();
}

// Replica el comando por Raft y devuelve el resultado de applyCommand.
async function propose(command) {
  try {
    return await node.propose(command);
  } catch (err) {
    if (err instanceof NotLeaderError) {
      const leader = config.raft.peers.find((peer) => peer.id === err.leaderId);
      throw notLeader(err.leaderId, {
        publicUrl: config.raft.publicUrls[err.leaderId],
        internalUrl: leader && leader.url,
      });
    }
    throw err;
  }
}

module.exports = { isEnabled, getNode, start, stop, propose };