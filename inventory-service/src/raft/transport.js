function createHttpTransport({ token, timeoutMs }) {
  async function post(peer, path, body) {
    const url = `${peer.url.replace(/\/+$/, '')}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-raft-token': token,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error(`RPC Raft ${peer.id} ${path} agotó el timeout de ${timeoutMs} ms`);
        }
        throw new Error(`No se pudo contactar al nodo ${peer.id} para ${path}: ${err.message}`);
      }

      let result;
      try {
        result = await response.json();
      } catch (err) {
        throw new Error(`El nodo ${peer.id} respondió JSON inválido a ${path}: ${err.message}`);
      }

      if (!response.ok) {
        throw new Error(
          `RPC Raft ${peer.id} ${path} respondió HTTP ${response.status}: ${result.message || 'error'}`,
        );
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    requestVote: (peer, body) => post(peer, '/raft/request-vote', body),
    appendEntries: (peer, body) => post(peer, '/raft/append-entries', body),
  };
}

module.exports = { createHttpTransport };
