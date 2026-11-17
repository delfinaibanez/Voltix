const express = require('express');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');
const requestLogger = require('./middlewares/requestLogger');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const healthRoutes = require('./routes/health.routes');
const orderRoutes = require('./routes/order.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // CSP desactivada: su "upgrade-insecure-requests" rompe Swagger UI sobre http://localhost.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.use('/health', healthRoutes);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Voltix - Órdenes' }));
  app.get('/api-docs.json', (req, res) => res.json(openapi));

  app.use('/api/orders', orderRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
