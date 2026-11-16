const { CATEGORIES } = require('../models/product.model');

const errorResponse = (description, example) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example,
    },
  },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'ObjectId del producto (24 caracteres hexadecimales)',
  schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '665f1c2e8a1b2c3d4e5f6a7b' },
};

const badRequestId = errorResponse('Id con formato inválido o datos inválidos', {
  status: 400,
  error: 'Bad Request',
  message: 'El id no tiene un formato válido',
  details: [{ field: 'id', message: 'Debe ser un ObjectId de 24 caracteres hexadecimales' }],
});

const notFoundProduct = errorResponse('El id es válido pero el producto no existe', {
  status: 404,
  error: 'Not Found',
  message: 'No existe un producto con id 665f1c2e8a1b2c3d4e5f6a7b',
});

const conflictSku = errorResponse('Ya existe un producto con ese sku', {
  status: 409,
  error: 'Conflict',
  message: 'Ya existe un producto con ese valor de sku',
  details: [{ field: 'sku', message: 'Debe ser único' }],
});

const invalidBody = errorResponse('Datos inválidos o incompletos', {
  status: 400,
  error: 'Bad Request',
  message: 'Datos inválidos',
  details: [{ field: 'price', message: 'price no puede ser negativo' }],
});

const internalError = errorResponse('Error inesperado del servidor o de la persistencia', {
  status: 500,
  error: 'Internal Server Error',
  message: 'Error interno del servidor',
});

const productExample = {
  id: '665f1c2e8a1b2c3d4e5f6a7b',
  sku: 'MOU-LOGI-G203',
  name: 'Mouse Logitech G203 Lightsync',
  description: 'Mouse gamer 8000 DPI con iluminación RGB',
  category: 'MOUSE',
  brand: 'Logitech',
  price: 24999.99,
  imageUrl: 'https://voltix.example/img/g203.jpg',
  active: true,
  createdAt: '2026-11-16T20:00:00.000Z',
  updatedAt: '2026-11-16T20:00:00.000Z',
};

const inputExample = {
  sku: 'MOU-LOGI-G203',
  name: 'Mouse Logitech G203 Lightsync',
  description: 'Mouse gamer 8000 DPI con iluminación RGB',
  category: 'MOUSE',
  brand: 'Logitech',
  price: 24999.99,
  imageUrl: 'https://voltix.example/img/g203.jpg',
  active: true,
};

const productResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Product' },
      example: productExample,
    },
  },
});

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Voltix - catalog-service',
    version: '1.0.0',
    description:
      'Catálogo de productos de Voltix (accesorios de computación). ' +
      'Es el único servicio que crea y modifica productos.',
  },
  servers: [{ url: '/', description: 'Servidor actual (HTTP o HTTPS)' }],
  tags: [
    { name: 'Products', description: 'CRUD del catálogo de productos' },
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
                example: { service: 'catalog-service', status: 'ok' },
              },
            },
          },
        },
      },
    },
    '/api/products': {
      get: {
        tags: ['Products'],
        summary: 'Listar productos (con filtros y paginación)',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string', enum: CATEGORIES } },
          { name: 'q', in: 'query', description: 'Texto a buscar en el nombre', schema: { type: 'string', maxLength: 100 } },
          { name: 'minPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
          { name: 'maxPrice', in: 'query', schema: { type: 'number', minimum: 0 } },
          { name: 'active', in: 'query', schema: { type: 'boolean' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Página de productos',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProductList' },
                example: { data: [productExample], page: 1, limit: 20, total: 1, totalPages: 1 },
              },
            },
          },
          400: errorResponse('Parámetros de consulta inválidos', {
            status: 400,
            error: 'Bad Request',
            message: 'Parámetros de consulta inválidos',
            details: [{ field: 'limit', message: 'limit debe ser un entero entre 1 y 100' }],
          }),
          500: internalError,
        },
      },
      post: {
        tags: ['Products'],
        summary: 'Crear un producto',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProductInput' },
              example: inputExample,
            },
          },
        },
        responses: {
          201: productResponse('Producto creado'),
          400: invalidBody,
          409: conflictSku,
          500: internalError,
        },
      },
    },
    '/api/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Obtener un producto por id',
        parameters: [idParam],
        responses: {
          200: productResponse('Producto encontrado'),
          400: badRequestId,
          404: notFoundProduct,
          500: internalError,
        },
      },
      put: {
        tags: ['Products'],
        summary: 'Reemplazar un producto (todos los campos obligatorios)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProductInput' },
              example: inputExample,
            },
          },
        },
        responses: {
          200: productResponse('Producto reemplazado'),
          400: invalidBody,
          404: notFoundProduct,
          409: conflictSku,
          500: internalError,
        },
      },
      patch: {
        tags: ['Products'],
        summary: 'Modificar parcialmente un producto',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProductPatch' },
              example: { price: 22999, active: true },
            },
          },
        },
        responses: {
          200: productResponse('Producto modificado'),
          400: invalidBody,
          404: notFoundProduct,
          409: conflictSku,
          500: internalError,
        },
      },
      delete: {
        tags: ['Products'],
        summary: 'Eliminar un producto',
        parameters: [idParam],
        responses: {
          204: { description: 'Producto eliminado (sin contenido)' },
          400: badRequestId,
          404: notFoundProduct,
          500: internalError,
        },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '665f1c2e8a1b2c3d4e5f6a7b' },
          sku: { type: 'string', example: 'MOU-LOGI-G203' },
          name: { type: 'string', example: 'Mouse Logitech G203 Lightsync' },
          description: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          brand: { type: 'string' },
          price: { type: 'number', minimum: 0 },
          imageUrl: { type: 'string' },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductInput: {
        type: 'object',
        required: ['sku', 'name', 'category', 'price'],
        additionalProperties: false,
        properties: {
          sku: { type: 'string', pattern: '^[A-Za-z0-9-]{3,30}$', description: 'Único; se guarda en mayúsculas' },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', maxLength: 1000 },
          category: { type: 'string', enum: CATEGORIES },
          brand: { type: 'string', maxLength: 60 },
          price: { type: 'number', minimum: 0 },
          imageUrl: { type: 'string', maxLength: 500 },
          active: { type: 'boolean', default: true },
        },
      },
      ProductPatch: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          sku: { type: 'string', pattern: '^[A-Za-z0-9-]{3,30}$' },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          description: { type: 'string', maxLength: 1000 },
          category: { type: 'string', enum: CATEGORIES },
          brand: { type: 'string', maxLength: 60 },
          price: { type: 'number', minimum: 0 },
          imageUrl: { type: 'string', maxLength: 500 },
          active: { type: 'boolean' },
        },
      },
      ProductList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
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