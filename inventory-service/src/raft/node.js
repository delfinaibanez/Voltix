// Nodo Raft (TP4): elección de líder, replicación del log y commit por mayoría.
//
// Este archivo no sabe nada de Express ni de Mongo: recibe por constructor
//   - storage:   persistencia de term, votedFor, lastApplied y log
//   - transport: cómo llamar a los otros nodos (RequestVote / AppendEntries)
//   - apply:     la máquina de estados (applyCommand del inventario)
// Así se puede probar con un cluster en memoria y usar Mongo + HTTP en producción.
//
// Reglas que respeta (paper de Raft, figura 2):
//   - Un nodo solo vota una vez por término y solo por candidatos con log al día.
//   - El líder solo cuenta réplicas para hacer commit de entradas de SU término
//     (por eso al asumir agrega una entrada NOOP).
//   - El follower rechaza AppendEntries si prevLogIndex/prevLogTerm no coinciden
//     y trunca su log ante un conflicto.
//   - term, votedFor y el log se persisten ANTES de responder.
//   - Las entradas committed se aplican a la máquina de estados en orden.
//
// Todo el estado se modifica dentro de _exclusive(): una cola que ejecuta de a una
// las operaciones, así no se entrelazan los handlers mientras esperan a Mongo.

const AppError = require('../utils/appError');

const ROLES = { FOLLOWER: 'FOLLOWER', CANDIDATE: 'CANDIDATE', LEADER: 'LEADER' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Escritura recibida por un nodo que no es el líder.
class NotLeaderError extends Error {
  constructor(leaderId) {
    super(leaderId ? `Este nodo no es el líder (líder: ${leaderId})` : 'No hay un líder elegido');
    this.name = 'NotLeaderError';
    this.leaderId = leaderId || null;
  }
}

// Errores que se repiten igual en todos los nodos (validación, stock insuficiente,
// 404, 409): la entrada se considera aplicada. Cualquier otro error (Mongo caído,
// por ejemplo) NO se da por aplicado: se reintenta, para no divergir de los demás.
const isDeterministicError = (err) =>
  Boolean(err) &&
  (err.name === 'AppError' ||
    err.name === 'ValidationError' ||
    err.name === 'CastError' ||
    err.code === 11000);

class RaftNode {
  constructor({ id, peers, storage, transport, apply, logger, options = {} }) {
    this.id = id;
    this.peers = peers.filter((peer) => peer.id !== id); // [{ id, url }] sin este nodo
    this.storage = storage;
    this.transport = transport;
    this.applyFn = apply;
    this.log = logger;
    this.opts = {
      heartbeatMs: 300,
      electionMinMs: 1200,
      electionMaxMs: 2400,
      proposeTimeoutMs: 3000,
      batchSize: 50,
      applyRetryMs: 1000,
      ...options,
    };
    this.quorum = Math.floor((this.peers.length + 1) / 2) + 1;

    // Estado persistente
    this.currentTerm = 0;
    this.votedFor = null;
    this.entries = []; // { index, term, command }; la entrada de índice i está en entries[i - 1]
    // Estado volátil
    this.role = ROLES.FOLLOWER;
    this.leaderId = null;
    this.commitIndex = 0;
    this.lastApplied = 0; // se persiste: evita reaplicar todo el log al reiniciar
    // Estado del líder
    this.nextIndex = {};
    this.matchIndex = {};
    this.lastContact = {};
    this.inFlight = {};
    this.peerUp = {};

    this.pending = new Map(); // índice -> { resolve, reject, timer, term }
    this.votes = 0;
    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.stopped = true;
    this.applying = false;
    this.queue = Promise.resolve();
  }

  // ------------------------------------------------------------------ ciclo de vida

  async start() {
    const saved = await this.storage.load();
    this.currentTerm = saved.currentTerm;
    this.votedFor = saved.votedFor;
    this.entries = saved.entries;
    this.lastApplied = saved.lastApplied;
    this.commitIndex = this.lastApplied;
    this.stopped = false;

    this.log.info('Raft iniciado', {
      nodeId: this.id,
      term: this.currentTerm,
      votedFor: this.votedFor,
      lastLogIndex: this._lastLogIndex(),
      lastApplied: this.lastApplied,
      peers: this.peers.map((p) => p.id),
      quorum: this.quorum,
    });
    this._resetElectionTimer();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.electionTimer);
    clearInterval(this.heartbeatTimer);
    this._rejectPending(() => AppError.serviceUnavailable('El nodo se está apagando', 2));
    await this.queue.catch(() => {});
    this.log.info('Raft detenido', { nodeId: this.id });
  }

  // ------------------------------------------------------------------ utilidades

  _exclusive(fn) {
    const result = this.queue.then(() => fn());
    this.queue = result.catch(() => {});
    return result;
  }

  _lastLogIndex() {
    return this.entries.length;
  }

  _termAt(index) {
    if (index <= 0) return 0;
    const entry = this.entries[index - 1];
    return entry ? entry.term : 0;
  }

  _rejectPending(makeError) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(makeError());
    }
    this.pending.clear();
  }

  _markPeer(peer, up, err) {
    if (this.peerUp[peer.id] === up) return;
    this.peerUp[peer.id] = up;
    if (up) this.log.info('Nodo alcanzable', { peer: peer.id });
    else this.log.warn('Nodo no responde', { peer: peer.id, reason: err && err.message });
  }

  // ------------------------------------------------------------------ roles

  _resetElectionTimer() {
    clearTimeout(this.electionTimer);
    if (this.stopped) return;
    const { electionMinMs: min, electionMaxMs: max } = this.opts;
    const timeout = min + Math.floor(Math.random() * (max - min));
    this.electionTimer = setTimeout(() => {
      this._startElection().catch((err) => this.log.error('Falló la elección', { error: err.message }));
    }, timeout);
  }

  // Debe llamarse dentro de _exclusive().
  async _stepDown(newTerm, leaderId = null) {
    const previousRole = this.role;
    if (newTerm > this.currentTerm) {
      this.currentTerm = newTerm;
      this.votedFor = null;
      await this.storage.saveState({ currentTerm: this.currentTerm, votedFor: this.votedFor });
      this.log.info('Nuevo término', { term: this.currentTerm, role: this.role });
    }
    this.role = ROLES.FOLLOWER;
    this.leaderId = leaderId;

    if (previousRole === ROLES.LEADER) {
      clearInterval(this.heartbeatTimer);
      this.log.warn('Dejó de ser líder', { term: this.currentTerm });
      this._rejectPending(() =>
        AppError.serviceUnavailable('Se perdió el liderazgo antes de confirmar la escritura. Reintentá', 2),
      );
    }
    if (previousRole !== ROLES.FOLLOWER) this._resetElectionTimer();
  }

  async _startElection() {
    await this._exclusive(async () => {
      if (this.stopped || this.role === ROLES.LEADER) return;

      this.role = ROLES.CANDIDATE;
      this.currentTerm += 1;
      this.votedFor = this.id;
      this.leaderId = null;
      await this.storage.saveState({ currentTerm: this.currentTerm, votedFor: this.votedFor });
      this._resetElectionTimer();

      const term = this.currentTerm;
      const lastLogIndex = this._lastLogIndex();
      const lastLogTerm = this._termAt(lastLogIndex);
      this.votes = 1; // vota por sí mismo
      this.log.info('Elección iniciada', { term, lastLogIndex, lastLogTerm, quorum: this.quorum });

      if (this.votes >= this.quorum) {
        await this._becomeLeader();
        return;
      }
      for (const peer of this.peers) this._requestVote(peer, term, lastLogIndex, lastLogTerm);
    });
  }

  async _requestVote(peer, term, lastLogIndex, lastLogTerm) {
    let response;
    try {
      response = await this.transport.requestVote(peer, {
        term,
        candidateId: this.id,
        lastLogIndex,
        lastLogTerm,
      });
      this._markPeer(peer, true);
    } catch (err) {
      this._markPeer(peer, false, err);
      return;
    }

    await this._exclusive(async () => {
      if (this.stopped) return;
      if (response.term > this.currentTerm) {
        await this._stepDown(response.term);
        return;
      }
      if (this.role !== ROLES.CANDIDATE || this.currentTerm !== term) return; // respuesta vieja
      if (!response.voteGranted) {
        this.log.info('Voto denegado por el peer', { peer: peer.id, term });
        return;
      }
      this.votes += 1;
      this.log.info('Voto recibido', { peer: peer.id, term, votes: this.votes, quorum: this.quorum });
      if (this.votes >= this.quorum) await this._becomeLeader();
    }).catch((err) => this.log.error('Falló el manejo del voto', { error: err.message }));
  }

  // Debe llamarse dentro de _exclusive().
  async _becomeLeader() {
    this.role = ROLES.LEADER;
    this.leaderId = this.id;
    clearTimeout(this.electionTimer);

    const next = this._lastLogIndex() + 1;
    for (const peer of this.peers) {
      this.nextIndex[peer.id] = next;
      this.matchIndex[peer.id] = 0;
      this.lastContact[peer.id] = Date.now();
      this.inFlight[peer.id] = false;
    }
    this.log.info('Nuevo líder elegido', { nodeId: this.id, term: this.currentTerm, votes: this.votes });

    // NOOP del nuevo término: al replicarse, también confirma las entradas de términos anteriores.
    await this._appendLocal({ type: 'NOOP' });
    this._advanceCommit();

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this._onHeartbeatTick(), this.opts.heartbeatMs);
    this._broadcast();
  }

  _onHeartbeatTick() {
    if (this.stopped || this.role !== ROLES.LEADER) return;

    // Si el líder no ve a la mayoría, no puede commitear nada: renuncia.
    const now = Date.now();
    const reachable =
      1 + this.peers.filter((p) => now - (this.lastContact[p.id] || 0) < this.opts.electionMaxMs).length;
    if (reachable < this.quorum) {
      this._exclusive(async () => {
        if (this.role !== ROLES.LEADER) return;
        this.log.warn('El líder perdió contacto con la mayoría: renuncia', {
          term: this.currentTerm,
          alcanzables: reachable,
          quorum: this.quorum,
        });
        await this._stepDown(this.currentTerm);
      }).catch((err) => this.log.error('Falló la renuncia del líder', { error: err.message }));
      return;
    }
    this._broadcast();
  }

  // ------------------------------------------------------------------ log y replicación

  // Debe llamarse dentro de _exclusive() y siendo líder.
  async _appendLocal(command) {
    const entry = { index: this._lastLogIndex() + 1, term: this.currentTerm, command };
    await this.storage.appendEntries([entry]);
    this.entries.push(entry);
    return entry;
  }

  _broadcast() {
    for (const peer of this.peers) {
      this._replicate(peer).catch((err) =>
        this.log.error('Falló la replicación', { peer: peer.id, error: err.message }),
      );
    }
  }

  async _replicate(peer) {
    if (this.stopped || this.role !== ROLES.LEADER || this.inFlight[peer.id]) return;
    this.inFlight[peer.id] = true;
    try {
      // Si el follower va atrasado se sigue enviando lotes hasta alcanzarlo.
      for (let round = 0; round < 1000; round += 1) {
        const request = await this._exclusive(async () => {
          if (this.stopped || this.role !== ROLES.LEADER) return null;
          const next = this.nextIndex[peer.id];
          const prevLogIndex = next - 1;
          return {
            term: this.currentTerm,
            leaderId: this.id,
            prevLogIndex,
            prevLogTerm: this._termAt(prevLogIndex),
            entries: this.entries.slice(next - 1, next - 1 + this.opts.batchSize),
            leaderCommit: this.commitIndex,
          };
        });
        if (!request) return;

        if (request.entries.length === 0) {
          this.log.debug('Heartbeat enviado', { peer: peer.id, term: request.term });
        } else {
          this.log.info('Replicando entradas', {
            peer: peer.id,
            desde: request.entries[0].index,
            hasta: request.entries[request.entries.length - 1].index,
          });
        }

        let response;
        try {
          response = await this.transport.appendEntries(peer, request);
          this._markPeer(peer, true);
        } catch (err) {
          this._markPeer(peer, false, err);
          return;
        }

        const sendMore = await this._exclusive(async () => this._onAppendResponse(peer, request, response));
        if (!sendMore) return;
      }
    } finally {
      this.inFlight[peer.id] = false;
    }
  }

  // Debe llamarse dentro de _exclusive(). Devuelve true si hay que seguir enviando.
  async _onAppendResponse(peer, request, response) {
    if (this.stopped) return false;
    if (response.term > this.currentTerm) {
      await this._stepDown(response.term);
      return false;
    }
    if (this.role !== ROLES.LEADER || this.currentTerm !== request.term) return false; // respuesta vieja

    this.lastContact[peer.id] = Date.now();

    if (response.success) {
      const match = request.prevLogIndex + request.entries.length;
      if (match > this.matchIndex[peer.id]) this.matchIndex[peer.id] = match;
      this.nextIndex[peer.id] = this.matchIndex[peer.id] + 1;
      this._advanceCommit();
      return this.nextIndex[peer.id] <= this._lastLogIndex();
    }

    // El follower no tiene la entrada prevLogIndex (o tiene otro término): se retrocede.
    const hint = Number.isInteger(response.conflictIndex) ? response.conflictIndex : request.prevLogIndex;
    this.nextIndex[peer.id] = Math.max(1, Math.min(hint, request.prevLogIndex));
    this.log.info('Log del follower inconsistente: se retrocede', {
      peer: peer.id,
      prevLogIndex: request.prevLogIndex,
      nextIndex: this.nextIndex[peer.id],
    });
    return true;
  }

  // Debe llamarse dentro de _exclusive(). Solo hace commit de entradas del término actual.
  _advanceCommit() {
    for (let n = this._lastLogIndex(); n > this.commitIndex; n -= 1) {
      if (this._termAt(n) !== this.currentTerm) break;
      const replicas = 1 + this.peers.filter((p) => (this.matchIndex[p.id] || 0) >= n).length;
      if (replicas >= this.quorum) {
        this.commitIndex = n;
        this.log.info('Commit por mayoría', { commitIndex: n, term: this.currentTerm, replicas });
        this._triggerApply();
        break;
      }
    }
  }

  // ------------------------------------------------------------------ máquina de estados

  _triggerApply() {
    if (this.applying || this.stopped) return;
    this.applying = true;
    this._applyLoop()
      .catch((err) => this.log.error('Falló la aplicación de entradas', { error: err.message }))
      .finally(() => {
        this.applying = false;
        if (!this.stopped && this.lastApplied < this.commitIndex) this._triggerApply();
      });
  }

  async _applyLoop() {
    while (!this.stopped && this.lastApplied < this.commitIndex) {
      const index = this.lastApplied + 1;
      const entry = this.entries[index - 1];
      let result;
      let error = null;

      for (;;) {
        try {
          result = entry.command.type === 'NOOP' ? undefined : await this.applyFn(entry.command, entry);
          break;
        } catch (err) {
          if (isDeterministicError(err)) {
            error = err;
            break;
          }
          this.log.error('No se pudo aplicar la entrada; se reintenta', { index, error: err.message });
          if (this.stopped) return;
          await sleep(this.opts.applyRetryMs);
        }
      }

      this.lastApplied = index;
      await this.storage.saveLastApplied(index);
      const logFn = entry.command.type === 'NOOP' ? 'debug' : 'info';
      this.log[logFn]('Entrada aplicada', {
        index,
        term: entry.term,
        type: entry.command.type,
        resultado: error ? `rechazada (${error.message})` : 'ok',
      });

      const waiter = this.pending.get(index);
      if (waiter) {
        this.pending.delete(index);
        clearTimeout(waiter.timer);
        if (waiter.term !== entry.term) {
          waiter.reject(AppError.serviceUnavailable('La escritura se perdió por un cambio de líder. Reintentá', 2));
        } else if (error) waiter.reject(error);
        else waiter.resolve(result);
      }
    }
  }

  // Solo el líder acepta escrituras. Resuelve cuando la entrada se commiteó por
  // mayoría y se aplicó acá; devuelve lo mismo que applyCommand.
  propose(command) {
    return new Promise((resolve, reject) => {
      this._exclusive(async () => {
        if (this.stopped || this.role !== ROLES.LEADER) throw new NotLeaderError(this.leaderId);

        const entry = await this._appendLocal(command);
        const timer = setTimeout(() => {
          this.pending.delete(entry.index);
          reject(
            AppError.serviceUnavailable(
              'No se pudo confirmar la escritura con la mayoría de los nodos a tiempo. Reintentá',
              2,
            ),
          );
        }, this.opts.proposeTimeoutMs);
        this.pending.set(entry.index, { resolve, reject, timer, term: entry.term });

        this.log.info('Escritura recibida por el líder', { index: entry.index, type: command.type });
        this._advanceCommit(); // en un cluster de un solo nodo se confirma acá
        this._broadcast();
      }).catch(reject);
    });
  }

  // ------------------------------------------------------------------ RPC entrantes

  handleRequestVote({ term, candidateId, lastLogIndex, lastLogTerm }) {
    return this._exclusive(async () => {
      if (term < this.currentTerm) {
        this.log.info('Voto denegado: término viejo', { candidateId, term, currentTerm: this.currentTerm });
        return { term: this.currentTerm, voteGranted: false };
      }
      if (term > this.currentTerm) await this._stepDown(term);

      const myLastIndex = this._lastLogIndex();
      const myLastTerm = this._termAt(myLastIndex);
      const candidateUpToDate =
        lastLogTerm > myLastTerm || (lastLogTerm === myLastTerm && lastLogIndex >= myLastIndex);

      if ((this.votedFor === null || this.votedFor === candidateId) && candidateUpToDate) {
        this.votedFor = candidateId;
        await this.storage.saveState({ currentTerm: this.currentTerm, votedFor: this.votedFor });
        this._resetElectionTimer();
        this.log.info('Voto concedido', { candidateId, term: this.currentTerm });
        return { term: this.currentTerm, voteGranted: true };
      }

      this.log.info('Voto denegado', {
        candidateId,
        term: this.currentTerm,
        votedFor: this.votedFor,
        logAlDia: candidateUpToDate,
      });
      return { term: this.currentTerm, voteGranted: false };
    });
  }

  handleAppendEntries({ term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit }) {
    return this._exclusive(async () => {
      if (term < this.currentTerm) return { term: this.currentTerm, success: false };

      // Hay un líder legítimo para este término.
      if (term > this.currentTerm || this.role !== ROLES.FOLLOWER) await this._stepDown(term, leaderId);
      if (this.leaderId !== leaderId) this.log.info('Líder reconocido', { leaderId, term });
      this.leaderId = leaderId;
      this._resetElectionTimer();

      if (entries.length === 0) this.log.debug('Heartbeat recibido', { leaderId, term });

      // Chequeo de consistencia: tengo que tener la entrada anterior, con el mismo término.
      if (prevLogIndex > this._lastLogIndex()) {
        return { term: this.currentTerm, success: false, conflictIndex: this._lastLogIndex() + 1 };
      }
      if (prevLogIndex > 0 && this._termAt(prevLogIndex) !== prevLogTerm) {
        const conflictTerm = this._termAt(prevLogIndex);
        let conflictIndex = prevLogIndex;
        while (conflictIndex > 1 && this._termAt(conflictIndex - 1) === conflictTerm) conflictIndex -= 1;
        return { term: this.currentTerm, success: false, conflictIndex };
      }

      // Agregar entradas nuevas; si una existente choca (mismo índice, otro término) se trunca desde ahí.
      const toAppend = [];
      let truncateFrom = null;
      for (const entry of entries) {
        if (truncateFrom === null && entry.index <= this._lastLogIndex()) {
          if (this._termAt(entry.index) === entry.term) continue; // ya la tengo
          truncateFrom = entry.index;
        }
        toAppend.push(entry);
      }
      if (truncateFrom !== null) {
        this.log.warn('Conflicto en el log: se trunca', { desdeIndice: truncateFrom, leaderId });
        await this.storage.truncateFrom(truncateFrom);
        this.entries.length = truncateFrom - 1;
      }
      if (toAppend.length > 0) {
        await this.storage.appendEntries(toAppend);
        this.entries.push(...toAppend);
        this.log.info('Entradas replicadas desde el líder', {
          desde: toAppend[0].index,
          hasta: toAppend[toAppend.length - 1].index,
          leaderId,
        });
      }

      const lastNewIndex = prevLogIndex + entries.length;
      if (leaderCommit > this.commitIndex) {
        this.commitIndex = Math.min(leaderCommit, lastNewIndex);
        this.log.info('Commit actualizado por el líder', { commitIndex: this.commitIndex });
        this._triggerApply();
      }
      return { term: this.currentTerm, success: true, matchIndex: lastNewIndex };
    });
  }

  // ------------------------------------------------------------------ diagnóstico

  getStatus() {
    const lastLogIndex = this._lastLogIndex();
    return {
      nodeId: this.id,
      role: this.role,
      term: this.currentTerm,
      leaderId: this.leaderId,
      votedFor: this.votedFor,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      lastLogIndex,
      lastLogTerm: this._termAt(lastLogIndex),
      quorum: this.quorum,
      peers: this.peers.map((peer) => ({
        id: peer.id,
        up: this.peerUp[peer.id] === undefined ? null : this.peerUp[peer.id],
        ...(this.role === ROLES.LEADER
          ? { nextIndex: this.nextIndex[peer.id], matchIndex: this.matchIndex[peer.id] }
          : {}),
      })),
    };
  }

  getLog(from = 1, limit = 100) {
    const start = Math.max(1, from);
    return this.entries.slice(start - 1, start - 1 + limit);
  }
}

module.exports = { RaftNode, NotLeaderError, ROLES };