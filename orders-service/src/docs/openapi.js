// Especificación OpenAPI escrita a mano (sin swagger-jsdoc).

const errorResponse = (description, example) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example } },
});

const retryAfter = {
  'Retry-After': { description: 'Segundos sugeridos antes de reintentar', schema: { type: 'integer', example: 2 } },
};

const responses = {
  badRequest: errorResponse('Body, query o id con formato inválido', {
    status: 400,
    error: 'Bad Request',
    message: 'Datos inválidos',
    details: [{ field: 'items[0].quantity', message: 'quantity debe ser un entero entre 1 y 10000' }],
  }),
  unauthorized: errorResponse('Falta el token Bearer, es inválido, tiene firma incorrecta o está vencido', {
    status: 401,
    error: 'Unauthorized',
    message: 'Token vencido',
  }),
  forbidden: errorResponse('El token es válido pero no alcanza (la orden es de otro usuario)', {
    status: 403,
    error: 'Forbidden',
    message: 'No tenés permisos para acceder a esta orden',
  }),
  orderNotFound: errorResponse('La orden no existe', {
    status: 404,
    error: 'Not Found',
    message: 'No existe la orden 665f1c2e8a1b2c3d4e5f6a7b',
  }),
  createNotFound: errorResponse(
    'Un producto no existe en catalog-service, o no tiene stock registrado en inventory-service. Es un error funcional: NO se convierte en 503.',
    { status: 404, error: 'Not Found', message: 'El producto 665f1c2e8a1b2c3d4e5f6a7b no existe en el catálogo' },
  ),
  createConflict: errorResponse('Stock insuficiente (409 de inventory-service) o producto inactivo. Las reservas ya hechas se liberan.', {
    status: 409,
    error: 'Conflict',
    message: 'Stock insuficiente (producto 665f1c2e8a1b2c3d4e5f6a7b)',
    details: [{ field: 'quantity', message: 'Disponible: 1, solicitado: 5' }],
  }),
  cancelConflict: errorResponse('La orden ya estaba cancelada', {
    status: 409,
    error: 'Conflict',
    message: 'La orden 665f1c2e8a1b2c3d4e5f6a7b ya estaba cancelada',
  }),
  badGateway: errorResponse('catalog-service o inventory-service respondieron 5xx o algo fuera de contrato', {
    status: 502,
    error: 'Bad Gateway',
    message: 'inventory-service respondió 500',
  }),
  serviceUnavailable: {
    description:
      'Una dependencia no respondió (red, DNS, timeout o 503): catalog-service o inventory-service. El mensaje nombra la dependencia.',
    headers: retryAfter,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: {
          status: 503,
          error: 'Service Unavailable',
          message: 'inventory-service no está disponible (timeout tras 3000 ms)',
        },
      },
    },
  },
};

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Id de la orden (ObjectId de 24 caracteres hexadecimales)',
  schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '665f1c2e8a1b2c3d4e5f6a7b' },
};

const orderOk = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
});

const secured = [{ bearerAuth: [] }];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Voltix - orders-service',
    version: '1.0.0',
    description:
      'Órdenes de compra. Valida el catálogo (catalog-service), reserva stock (inventory-service) y guarda la orden.\n\n' +
      '**Autenticación:** `Authorization: Bearer <JWT>` (HS256, emitido por auth-service). ' +
      'El `userId` de la orden es el `sub` del token. USER ve y cancela solo sus órdenes; ADMIN todas.\n\n' +
      'El header Authorization se reenvía a catalog-service e inventory-service.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Orders' }, { name: 'Health' }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Estado del servicio',
        responses: {
          200: {
            description: 'Servicio activo',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { service: { type: 'string', example: 'orders-service' }, status: { type: 'string', example: 'ok' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Crear una orden (USER o ADMIN)',
        description:
          'Por cada ítem: consulta el catálogo (debe existir y estar activo; el precio sale de ahí) y reserva stock. ' +
          'Si una reserva falla, libera las ya hechas y devuelve el error correspondiente.',
        security: secured,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrder' } } },
        },
        responses: {
          201: {
            ...orderOk('Orden confirmada'),
            headers: { Location: { description: 'URL de la orden creada', schema: { type: 'string' } } },
          },
          400: responses.badRequest,
          401: responses.unauthorized,
          403: errorResponse('Rol no permitido', { status: 403, error: 'Forbidden', message: 'No tenés permisos para esta operación' }),
          404: responses.createNotFound,
          409: responses.createConflict,
          502: responses.badGateway,
          503: responses.serviceUnavailable,
        },
      },
      get: {
        tags: ['Orders'],
        summary: 'Listar órdenes (USER: las suyas; ADMIN: todas)',
        security: secured,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Página de órdenes, de la más nueva a la más vieja',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderList' } } },
          },
          400: responses.badRequest,
          401: responses.unauthorized,
          503: responses.serviceUnavailable,
        },
      },
    },
    '/api/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Obtener una orden (dueño o ADMIN)',
        security: secured,
        parameters: [idParam],
        responses: {
          200: orderOk('La orden'),
          400: responses.badRequest,
          401: responses.unauthorized,
          403: responses.forbidden,
          404: responses.orderNotFound,
          503: responses.serviceUnavailable,
        },
      },
    },
    '/api/orders/{id}/cancel': {
      post: {
        tags: ['Orders'],
        summary: 'Cancelar una orden (dueño o ADMIN) y liberar su stock',
        security: secured,
        parameters: [idParam],
        responses: {
          200: orderOk('Orden con status CANCELLED'),
          400: responses.badRequest,
          401: responses.unauthorized,
          403: responses.forbidden,
          404: responses.orderNotFound,
          409: responses.cancelConflict,
          502: responses.badGateway,
          503: responses.serviceUnavailable,
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
        description:
          'JWT HS256 emitido por auth-service (POST /api/auth/login). Claims: sub, role (USER|ADMIN), iat, exp, iss. ' +
          'Sin token, mal formado, con firma inválida o vencido -> 401. Token válido pero sin permiso sobre el recurso -> 403.',
      },
    },
    schemas: {
      CreateOrder: {
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {
              type: 'object',
              required: ['productId', 'quantity'],
              additionalProperties: false,
              properties: {
                productId: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '665f1c2e8a1b2c3d4e5f6a7b' },
                quantity: { type: 'integer', minimum: 1, maximum: 10000, example: 2 },
              },
            },
          },
        },
      },
      OrderItem: {
        type: 'object',
        properties: {
          productId: { type: 'string', example: '665f1c2e8a1b2c3d4e5f6a7b' },
          name: { type: 'string', example: 'Mouse inalámbrico' },
          unitPrice: { type: 'number', example: 12999.5 },
          quantity: { type: 'integer', example: 2 },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '665f1c2e8a1b2c3d4e5f6a7c' },
          userId: { type: 'string', description: 'sub del token' },
          items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
          total: { type: 'number', example: 25999 },
          status: { type: 'string', enum: ['CONFIRMED', 'CANCELLED'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OrderList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          status: { type: 'integer' },
          error: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};
