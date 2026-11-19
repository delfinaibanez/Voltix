// Endpoints de Raft, separados de la API de negocio (/api/stock):
//   POST /raft/request-vote     RPC interno (solo nodos, con x-raft-token)
//   POST /raft/append-entries   RPC interno (solo nodos, con x-raft-token)
//   GET  /raft/status           diagnóstico: id, rol, término, líder
//   GET  /raft/log              diagnóstico: entradas del log (solo ADMIN)

const crypto = require('node:crypto');
const { Router } = require('express');
const AppError = require('../utils/appError');

const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;

function validateVote(body) {
  const ok =
    body &&
    isInt(body.term, 1) &&
    typeof body.candidateId === 'string' &&
    body.candidateId !== '' &&
    isInt(body.lastLogIndex) &&
    isInt(body.lastLogTerm);
  if (!ok) throw AppError.badRequest('RequestVote inválido');
  return body;
}

function validateAppend(body) {
  const ok =
    body &&
    isInt(body.term, 1) &&
    typeof body.leaderId === 'string' &&
    body.leaderId !== '' &&
    isInt(body.prevLogIndex) &&
    isInt(body.prevLogTerm) &&
    isInt(body.leaderCommit) &&
    Array.isArray(body.entries) &&
    body.entries.length <= 500 &&
    body.entries.every(
      (e) =>
        e &&
        isInt(e.index, 1) &&
        isInt(e.term, 1) &&
        e.command &&
        typeof e.command === 'object' &&
        typeof e.command.type === 'string',
    );
  if (!ok) throw AppError.badRequest('AppendEntries inválido');
  return body;
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function createRaftRouter({ getNode, token, authenticate, authorize }) {
  const router = Router();

  const requireNode = (req, res, next) => {
    if (!getNode()) throw AppError.notFound('Raft no está habilitado en este nodo');
    next();
  };

  // Los RPC solo pueden venir de otro nodo del cluster: comparten un token.
  const requireClusterToken = (req, res, next) => {
    const received = req.get('x-raft-token');
    if (!received || !crypto.timingSafeEqual(digest(received), digest(token))) {
      throw AppError.unauthorized('Token de cluster inválido');
    }
    next();
  };

  router.post('/request-vote', requireNode, requireClusterToken, async (req, res) => {
    res.json(await getNode().handleRequestVote(validateVote(req.body)));
  });

  router.post('/append-entries', requireNode, requireClusterToken, async (req, res) => {
    res.json(await getNode().handleAppendEntries(validateAppend(req.body)));
  });

  router.get('/status', (req, res) => {
    const node = getNode();
    res.json(node ? { enabled: true, ...node.getStatus() } : { enabled: false });
  });

  router.get('/log', authenticate, authorize('ADMIN'), requireNode, (req, res) => {
    const from = Number.parseInt(req.query.from, 10);
    const limit = Number.parseInt(req.query.limit, 10);
    const node = getNode();
    const entries = node.getLog(
      Number.isNaN(from) ? 1 : from,
      Number.isNaN(limit) ? 100 : Math.min(Math.max(limit, 1), 500),
    );
    res.json({ nodeId: node.id, lastLogIndex: node.getStatus().lastLogIndex, entries });
  });

  return router;
}

module.exports = { createRaftRouter };