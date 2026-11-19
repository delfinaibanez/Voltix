const assert = require('node:assert/strict');
const test = require('node:test');
const { RaftNode } = require('../src/raft/node');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await delay(10);
  }
  throw new Error(`La condición no se cumplió en ${timeoutMs} ms`);
}

class MemoryStorage {
  constructor() {
    this.currentTerm = 0;
    this.votedFor = null;
    this.lastApplied = 0;
    this.entries = [];
  }

  async load() {
    return {
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      lastApplied: this.lastApplied,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }

  async saveState({ currentTerm, votedFor }) {
    this.currentTerm = currentTerm;
    this.votedFor = votedFor;
  }

  async saveLastApplied(index) {
    this.lastApplied = index;
  }

  async appendEntries(entries) {
    for (const entry of entries) {
      this.entries[entry.index - 1] = { ...entry };
    }
  }

  async truncateFrom(index) {
    this.entries.length = index - 1;
  }
}

test('elige un líder y replica escrituras confirmadas por mayoría', async (t) => {
  const ids = ['inventory-1', 'inventory-2', 'inventory-3'];
  const nodes = new Map();
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  const peers = ids.map((id) => ({ id, url: `http://${id}:3000` }));
  const transport = {
    requestVote: (peer, request) => nodes.get(peer.id).handleRequestVote(request),
    appendEntries: (peer, request) => nodes.get(peer.id).handleAppendEntries(request),
  };
  const applied = new Map(ids.map((id) => [id, []]));

  for (const id of ids) {
    nodes.set(
      id,
      new RaftNode({
        id,
        peers,
        storage: new MemoryStorage(),
        transport,
        apply: async (command) => {
          applied.get(id).push(command);
          return command.available;
        },
        logger,
        options: {
          heartbeatMs: 25,
          electionMinMs: 120,
          electionMaxMs: 220,
          proposeTimeoutMs: 1500,
          applyRetryMs: 10,
        },
      }),
    );
  }

  t.after(() => Promise.all(Array.from(nodes.values(), (node) => node.stop())));
  await Promise.all(Array.from(nodes.values(), (node) => node.start()));

  const leader = await waitFor(() => Array.from(nodes.values()).find((node) => node.role === 'LEADER'));
  const result = await leader.propose({ type: 'SET_STOCK', productId: 'product-1', available: 8 });

  assert.equal(result, 8);
  await waitFor(() => ids.every((id) => applied.get(id).some((command) => command.productId === 'product-1')));
  for (const id of ids) {
    assert.deepEqual(applied.get(id).find((command) => command.productId === 'product-1'), {
      type: 'SET_STOCK',
      productId: 'product-1',
      available: 8,
    });
  }
});
