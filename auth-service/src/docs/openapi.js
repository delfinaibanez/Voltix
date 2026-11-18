const errorResponse = (description, example) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example,
    },
  },
});

const invalidBody = errorResponse('Datos inválidos o incompletos', {
  status: 400,
  error: 'Bad Request',
  message: 'Datos inválidos',
  details: [{ field: 'password', message: 'password es obligatorio (8 a 72 caracteres)' }],
});

const unauthorized = errorResponse('Falta el token, está mal formado, tiene firma inválida o venció', {
  status: 401,
  error: 'Unauthorized',
  message: 'Token inválido',
});

const forbidden = errorResponse('Identidad válida pero sin el rol necesario', {
  status: 403,
  error: 'Forbidden',
  message: 'No tenés permisos para realizar esta operación',
});

const internalError = errorResponse('Error inesperado del servidor', {
  status: 500,
  error: 'Internal Server Error',
  message: 'Error interno del servidor',
});

const userExample = {
  id: '665f1c2e8a1b2c3d4e5f6a7b',
  email: 'ana@example.com',
  name: 'Ana Pérez',
  role: 'USER',
  active: true,
  createdAt: '2026-11-17T20:00:00.000Z',
  updatedAt: '2026-11-17T20:00:00.000Z',
};

const userResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/User' },
      example: userExample,
    },
  },
});

const bearer = [{ bearerAuth: [] }];

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Voltix - auth-service',
    version: '1.0.0',
    description:
      'Identidad de Voltix: registro, login y emisión de JWT (HS256). ' +
      'Es el único servicio que conoce las credenciales. Los demás servicios validan la firma del token localmente.',
  },
  servers: [{ url: '/', description: 'Servidor actual (HTTP o HTTPS)' }],
  tags: [
    { name: 'Auth', description: 'Registro y autenticación' },
    { name: 'Users', description: 'Operaciones protegidas por rol' },
    { name: 'Health', description: 'Estado del servicio' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Estado del servicio',
        responses: {
          200: {
            description: 'El servicio está activo',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { service: 'auth-service', status: 'ok' },
              },
            },
          },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Registrar un usuario (siempre con rol USER)',
        description: 'El rol no se puede elegir: enviar "role" devuelve 400. Nunca se devuelve la contraseña ni su hash.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterInput' },
              example: { email: 'ana@example.com', name: 'Ana Pérez', password: 'Clave-segura-123' },
            },
          },
        },
        responses: {
          201: userResponse('Usuario creado'),
          400: invalidBody,
          409: errorResponse('Ya existe un usuario con ese email', {
            status: 409,
            error: 'Conflict',
            message: 'Ya existe un usuario con ese email',
            details: [{ field: 'email', message: 'Debe ser único' }],
          }),
          500: internalError,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Iniciar sesión y obtener un JWT',
        description:
          'Si el email no existe o la contraseña es incorrecta la respuesta es la misma (401), ' +
          'para no revelar qué usuarios están registrados.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginInput' },
              example: { email: 'ana@example.com', password: 'Clave-segura-123' },
            },
          },
        },
        responses: {
          200: {
            description: 'Autenticación correcta',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenResponse' },
                example: { accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', tokenType: 'Bearer', expiresIn: 3600 },
              },
            },
          },
          400: invalidBody,
          401: errorResponse('Credenciales inválidas', {
            status: 401,
            error: 'Unauthorized',
            message: 'Credenciales inválidas',
          }),
          403: errorResponse('Credenciales correctas pero la cuenta está deshabilitada', {
            status: 403,
            error: 'Forbidden',
            message: 'La cuenta está deshabilitada',
          }),
          500: internalError,
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Users'],
        summary: 'Datos del usuario autenticado',
        security: bearer,
        responses: {
          200: userResponse('Perfil del usuario del token'),
          401: unauthorized,
          500: internalError,
        },
      },
    },
    '/auth/users': {
      get: {
        tags: ['Users'],
        summary: 'Listar usuarios (solo ADMIN)',
        security: bearer,
        responses: {
          200: {
            description: 'Lista de usuarios (máximo 100)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'array', items: { $ref: '#/components/schemas/User' } } },
                },
                example: { data: [userExample] },
              },
            },
          },
          401: unauthorized,
          403: forbidden,
          500: internalError,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Pegar el accessToken devuelto por /auth/login (sin la palabra Bearer).',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['USER', 'ADMIN'] },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      RegisterInput: {
        type: 'object',
        required: ['email', 'name', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 120 },
          name: { type: 'string', minLength: 2, maxLength: 80 },
          password: { type: 'string', minLength: 8, maxLength: 72, format: 'password' },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' },
        },
      },
      TokenResponse: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          tokenType: { type: 'string', example: 'Bearer' },
          expiresIn: { type: 'integer', description: 'Segundos de validez' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          status: { type: 'string', example: 'ok' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          status: { type: 'integer' },
          error: { type: 'string' },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: { field: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

module.exports = openapi;