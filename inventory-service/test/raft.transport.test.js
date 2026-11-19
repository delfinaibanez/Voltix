const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { createHttpTransport } = require('../src/raft/transport');

test('envía los RPC Raft al endpoint correcto con el token compartido', async (t) => {
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = { path: req.url, token: req.headers['x-raft-token'], body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ term: 2, voteGranted: true }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));

  const address = server.address();
  const transport = createHttpTransport({ token: 'raft-test-token', timeoutMs: 1000 });
  const request = { term: 2, candidateId: 'inventory-1', lastLogIndex: 3, lastLogTerm: 2 };
  const response = await transport.requestVote(
    { id: 'inventory-2', url: `http://127.0.0.1:${address.port}/` },
    request,
  );

  assert.deepEqual(response, { term: 2, voteGranted: true });
  assert.deepEqual(received, {
    path: '/raft/request-vote',
    token: 'raft-test-token',
    body: request,
  });
});
