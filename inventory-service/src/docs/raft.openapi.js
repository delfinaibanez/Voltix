// Documentación OpenAPI de Raft (TP4). Va separada de la API de negocio:
//   - "Raft - diagnóstico": estado y log del nodo (para mirar el cluster).
//   - "Raft - RPC internos": los llaman los otros nodos, no los clientes.

const errorBody = (status, error, message) => ({
  schema: { $ref: '#/components/schemas/Error' },
  example: { status, error, message },
});

const openapi = {
  tags: [
    { name: 'Raft - diagnóstico', description: 'Estado del nodo dentro del cluster Raft y su log' },
    {
      name: 'Raft - RPC internos',
      description:
        'Los usan los nodos entre sí (RequestVote y AppendEntries). Exigen el header x-raft-token. ' +
        'No son parte de la API de negocio.',
    },
  ],

  securitySchemes: {
    raftToken: {
      type: 'apiKey',
      in: 'header',
      name: 'x-raft-token',
      description: 'Secreto compartido por los nodos del cluster (RAFT_TOKEN)',
    },
  },

  paths: {
    '/raft/status': {
      get: {
        tags: ['Raft - diagnóstico'],
        summary: 'Estado del nodo: id, rol, término y líder',
        description: 'Público y de solo lectura. Con RAFT_ENABLED=false devuelve { "enabled": false }.',
        responses: {
          200: {
            description: 'Estado actual del nodo',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RaftStatus' },
                example: {
                  enabled: true,
                  nodeId: 'inventory-1',
                  role: 'LEADER',
                  term: 3,
                  leaderId: 'inventory-1',
                  votedFor: 'inventory-1',
                  commitIndex: 12,
                  lastApplied: 12,
                  lastLogIndex: 12,
                  lastLogTerm: 3,
                  quorum: 2,
                  peers: [
                    { id: 'inventory-2', up: true, nextIndex: 13, matchIndex: 12 },
                    { id: 'inventory-3', up: true, nextIndex: 13, matchIndex: 12 },
                  ],
                },
              },
            },
          },
        },
      },
    },

    '/raft/log': {
      get: {
        tags: ['Raft - diagnóstico'],
        summary: 'Entradas del log de este nodo (solo ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Primer índice a devolver' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: {
          200: {
            description: 'Entradas del log',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nodeId: { type: 'string' },
                    lastLogIndex: { type: 'integer' },
                    entries: { type: 'array', items: { $ref: '#/components/schemas/RaftEntry' } },
                  },
                },
                example: {
                  nodeId: 'inventory-1',
                  lastLogIndex: 2,
                  entries: [
                    { index: 1, term: 3, command: { type: 'NOOP' } },
                    {
                      index: 2,
                      term: 3,
                      command: { type: 'RESERVE', productId: '665f1c2e8a1b2c3d4e5f6a7b', orderId: 'ord-1001', quantity: 2 },
                    },
                  ],
                },
              },
            },
          },
          401: { description: 'Falta el token Bearer o es inválido', content: { 'application/json': errorBody(401, 'Unauthorized', 'Token ausente o inválido') } },
          403: { description: 'Se requiere rol ADMIN', content: { 'application/json': errorBody(403, 'Forbidden', 'No tenés permisos para esta operación') } },
        },
      },
    },

    '/raft/request-vote': {
      post: {
        tags: ['Raft - RPC internos'],
        summary: 'RequestVote: un candidato pide el voto de este nodo',
        description:
          'Se concede si el término del candidato no es menor, este nodo no votó a otro en ese término ' +
          'y el log del candidato está al menos tan al día como el propio.',
        security: [{ raftToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RequestVoteInput' },
              example: { term: 4, candidateId: 'inventory-2', lastLogIndex: 12, lastLogTerm: 3 },
            },
          },
        },
        responses: {
          200: {
            description: 'Resultado de la votación',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { term: { type: 'integer' }, voteGranted: { type: 'boolean' } } },
                example: { term: 4, voteGranted: true },
              },
            },
          },
          400: { description: 'RPC inválido', content: { 'application/json': errorBody(400, 'Bad Request', 'RequestVote inválido') } },
          401: { description: 'Token de cluster inválido', content: { 'application/json': errorBody(401, 'Unauthorized', 'Token de cluster inválido') } },
        },
      },
    },

    '/raft/append-entries': {
      post: {
        tags: ['Raft - RPC internos'],
        summary: 'AppendEntries: el líder replica entradas (o envía un heartbeat si no hay ninguna)',
        description:
          'El follower verifica prevLogIndex / prevLogTerm; si no coinciden responde success=false con ' +
          'conflictIndex y el líder retrocede. Si hay entradas que chocan con las propias, las trunca.',
        security: [{ raftToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AppendEntriesInput' },
              example: {
                term: 4,
                leaderId: 'inventory-2',
                prevLogIndex: 12,
                prevLogTerm: 3,
                entries: [{ index: 13, term: 4, command: { type: 'NOOP' } }],
                leaderCommit: 12,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Resultado de la replicación',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    term: { type: 'integer' },
                    success: { type: 'boolean' },
                    matchIndex: { type: 'integer' },
                    conflictIndex: { type: 'integer' },
                  },
                },
                example: { term: 4, success: true, matchIndex: 13 },
              },
            },
          },
          400: { description: 'RPC inválido', content: { 'application/json': errorBody(400, 'Bad Request', 'AppendEntries inválido') } },
          401: { description: 'Token de cluster inválido', content: { 'application/json': errorBody(401, 'Unauthorized', 'Token de cluster inválido') } },
        },
      },
    },
  },

  schemas: {
    RaftStatus: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        nodeId: { type: 'string' },
        role: { type: 'string', enum: ['FOLLOWER', 'CANDIDATE', 'LEADER'] },
        term: { type: 'integer' },
        leaderId: { type: 'string', nullable: true },
        votedFor: { type: 'string', nullable: true },
        commitIndex: { type: 'integer' },
        lastApplied: { type: 'integer' },
        lastLogIndex: { type: 'integer' },
        lastLogTerm: { type: 'integer' },
        quorum: { type: 'integer' },
        peers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              up: { type: 'boolean', nullable: true },
              nextIndex: { type: 'integer', description: 'Solo en el líder' },
              matchIndex: { type: 'integer', description: 'Solo en el líder' },
            },
          },
        },
      },
    },
    RaftEntry: {
      type: 'object',
      properties: {
        index: { type: 'integer' },
        term: { type: 'integer' },
        command: {
          type: 'object',
          description: 'SET_STOCK, RESERVE, RELEASE o NOOP (el líder lo agrega al asumir)',
          properties: { type: { type: 'string', enum: ['SET_STOCK', 'RESERVE', 'RELEASE', 'NOOP'] } },
        },
      },
    },
    RequestVoteInput: {
      type: 'object',
      required: ['term', 'candidateId', 'lastLogIndex', 'lastLogTerm'],
      properties: {
        term: { type: 'integer', minimum: 1 },
        candidateId: { type: 'string' },
        lastLogIndex: { type: 'integer', minimum: 0 },
        lastLogTerm: { type: 'integer', minimum: 0 },
      },
    },
    AppendEntriesInput: {
      type: 'object',
      required: ['term', 'leaderId', 'prevLogIndex', 'prevLogTerm', 'entries', 'leaderCommit'],
      properties: {
        term: { type: 'integer', minimum: 1 },
        leaderId: { type: 'string' },
        prevLogIndex: { type: 'integer', minimum: 0 },
        prevLogTerm: { type: 'integer', minimum: 0 },
        entries: { type: 'array', items: { $ref: '#/components/schemas/RaftEntry' } },
        leaderCommit: { type: 'integer', minimum: 0 },
      },
    },
  },
};

module.exports = openapi;