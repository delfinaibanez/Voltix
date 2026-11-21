// Especificación OpenAPI escrita a mano (sin swagger-jsdoc).

const errorResponse = (description, example) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example,
    },
  },
});

const productIdParam = {
  name: 'productId',
  in: 'path',
  required: true,
  description: 'Id del producto en catalog-service (ObjectId de 24 caracteres hexadecimales)',
  schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '665f1c2e8a1b2c3d4e5f6a7b' },
};

const badRequest = (message, details) =>
  errorResponse('productId con formato inválido o body inválido', {
    status: 400,
    error: 'Bad Request',
    message,
    details,
  });

const unauthorized = errorResponse('Falta el token Bearer o es inválido / está vencido', {
  status: 401,
  error: 'Unauthorized',
  message: 'Falta el token de acceso (Authorization: Bearer <token>)',
});

const forbidden = errorResponse('El token es válido pero el rol no alcanza (se requiere ADMIN)', {
  status: 403,
  error: 'Forbidden',
  message: 'No tenés permisos para realizar esta operación',
});

const notFoundStock = errorResponse('No hay stock registrado para ese producto', {
  status: 404,
  error: 'Not Found',
  message: 'No hay stock registrado para el producto 665f1c2e8a1b2c3d4e5f6a7b',
});

const serviceUnavailable = {
  description:
    'No se consiguió el lock del producto dentro de LOCK_WAIT_MS, o Redis / MongoDB no están disponibles. ' +
    'Incluye el header Retry-After (segundos).',
  headers: {
    'Retry-After': {
      description: 'Segundos sugeridos antes de reintentar',
      schema: { type: 'integer', example: 3 },
    },
  },
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: {
        status: 503,
        error: 'Service Unavailable',
        message: 'El producto está siendo modificado por otra operación. Reintentá en unos segundos.',
      },
    },
  },
};

const internalError = errorResponse('Error inesperado del servidor', {
  status: 500,
  error: 'Internal Server Error',
  message: 'Error interno del servidor',
});

const stockExample = { productId: '665f1c2e8a1b2c3d4e5f6a7b', available: 48, reserved: 2 };

const stockResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Stock' },
      example: stockExample,
    },
  },
});

const reservationResponse = (description, status = 'RESERVED') => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Reservation' },
      example: { orderId: 'ord-1001', productId: '665f1c2e8a1b2c3d4e5f6a7b', quantity: 2, status },
    },
  },
});

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Voltix - Inventory Service',
    version: '1.0.0',
    description:
      'Stock y reservas de los productos de Voltix. Las escrituras (set stock, reserve, release) se ' +
      'ejecutan en exclusión mutua por producto con un lock distribuido en Redis ' +
      '(SET NX PX + liberación con script Lua) y, con Raft activo, se replican y confirman por mayoría. ' +
      'Las reservas son idempotentes por (orderId, productId).',
  },
  servers: [{ url: '/', description: 'Servidor actual (HTTP o HTTPS)' }],
  tags: [
    { name: 'Health', description: 'Estado del servicio' },
    { name: 'Stock', description: 'Consulta y carga de stock' },
    { name: 'Reservas', description: 'Reserva y liberación de stock por orden' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Healthcheck',
        responses: {
          200: {
            description: 'El servicio está levantado',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
                example: { service: 'inventory-service', status: 'ok' },
              },
            },
          },
        },
      },
    },
    '/api/stock/{productId}': {
      get: {
        tags: ['Stock'],
        summary: 'Consultar el stock de un producto (USER o ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [productIdParam],
        responses: {
          200: stockResponse('Stock del producto'),
          400: badRequest('El productId no tiene un formato válido', [
            { field: 'productId', message: 'Debe ser un ObjectId de 24 caracteres hexadecimales' },
          ]),
          401: unauthorized,
          404: notFoundStock,
          500: internalError,
        },
      },
      put: {
        tags: ['Stock'],
        summary: 'Fijar las unidades disponibles de un producto (solo ADMIN)',
        description:
          'Crea el stock si no existía (201) o actualiza "available" (200). Las unidades reservadas no se modifican.',
        security: [{ bearerAuth: [] }],
        parameters: [productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SetStockInput' },
              example: { available: 50 },
            },
          },
        },
        responses: {
          200: stockResponse('Stock actualizado'),
          201: stockResponse('Stock creado'),
          400: badRequest('Datos inválidos', [
            { field: 'available', message: 'available debe ser un entero entre 0 y 1000000' },
          ]),
          401: unauthorized,
          403: forbidden,
          503: serviceUnavailable,
          500: internalError,
        },
      },
    },
    '/api/stock/{productId}/reserve': {
      post: {
        tags: ['Reservas'],
        summary: 'Reservar stock para una orden (solo orders-service, rol SERVICE)',
        description:
          'Descuenta "quantity" de available y lo suma a reserved. Idempotente por (orderId, productId): ' +
          'repetir la misma reserva devuelve 200 con la reserva existente sin descontar de nuevo.',
        security: [{ bearerAuth: [] }],
        parameters: [productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReserveInput' },
              example: { orderId: 'ord-1001', quantity: 2 },
            },
          },
        },
        responses: {
          201: reservationResponse('Reserva creada'),
          200: reservationResponse('La reserva ya existía (repetición idempotente)'),
          400: badRequest('Datos inválidos', [
            { field: 'quantity', message: 'quantity debe ser un entero entre 1 y 10000' },
          ]),
          401: unauthorized,
          404: notFoundStock,
          409: errorResponse(
            'Stock insuficiente, o la orden ya reservó otra cantidad / ya liberó esta reserva',
            {
              status: 409,
              error: 'Conflict',
              message: 'Stock insuficiente',
              details: [{ field: 'quantity', message: 'Disponible: 1, solicitado: 2' }],
            },
          ),
          503: serviceUnavailable,
          500: internalError,
        },
      },
    },
    '/api/stock/{productId}/release': {
      post: {
        tags: ['Reservas'],
        summary: 'Liberar la reserva de una orden (solo orders-service, rol SERVICE)',
        description:
          'Devuelve las unidades reservadas a available. Idempotente: liberar una reserva ya liberada responde 200 sin devolver stock otra vez.',
        security: [{ bearerAuth: [] }],
        parameters: [productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReleaseInput' },
              example: { orderId: 'ord-1001' },
            },
          },
        },
        responses: {
          200: reservationResponse('Reserva liberada', 'RELEASED'),
          400: badRequest('Datos inválidos', [
            { field: 'orderId', message: 'orderId es obligatorio: 1 a 64 caracteres (letras, números, guiones o guion bajo)' },
          ]),
          401: unauthorized,
          404: errorResponse('No existe una reserva de esa orden para ese producto', {
            status: 404,
            error: 'Not Found',
            message: 'No existe una reserva de la orden ord-1001 para el producto 665f1c2e8a1b2c3d4e5f6a7b',
          }),
          503: serviceUnavailable,
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
        description: 'JWT emitido por auth-service (HS256, issuer voltix-auth-service). Todas las rutas /api/stock lo requieren; orders-service reenvía el token del usuario.',
      },
    },
    schemas: {
      Stock: {
        type: 'object',
        properties: {
          productId: { type: 'string', example: '665f1c2e8a1b2c3d4e5f6a7b' },
          available: { type: 'integer', minimum: 0, description: 'Unidades libres para vender' },
          reserved: { type: 'integer', minimum: 0, description: 'Unidades apartadas por órdenes' },
        },
      },
      SetStockInput: {
        type: 'object',
        required: ['available'],
        additionalProperties: false,
        properties: {
          available: { type: 'integer', minimum: 0, maximum: 1000000 },
        },
      },
      ReserveInput: {
        type: 'object',
        required: ['orderId', 'quantity'],
        additionalProperties: false,
        properties: {
          orderId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          quantity: { type: 'integer', minimum: 1, maximum: 10000 },
        },
      },
      ReleaseInput: {
        type: 'object',
        required: ['orderId'],
        additionalProperties: false,
        properties: {
          orderId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        },
      },
      Reservation: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['RESERVED', 'RELEASED'] },
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

const raftDocs = require('./raft.openapi');
openapi.tags.push(...raftDocs.tags);
Object.assign(openapi.paths, raftDocs.paths);
Object.assign(openapi.components.schemas, raftDocs.schemas);
Object.assign(openapi.components.securitySchemes, raftDocs.securitySchemes);

module.exports = openapi;
