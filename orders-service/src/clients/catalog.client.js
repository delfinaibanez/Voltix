const config = require('../config/env');
const AppError = require('../utils/appError');
const { callService } = require('./httpClient');

const DEPENDENCY = 'catalog-service';

// GET /api/products/:id -> { id, name, price, active, ... }
// 404 -> 404 (el producto no existe), no se convierte en 503.
async function getProduct(productId, authorization) {
  const { data } = await callService({
    dependency: DEPENDENCY,
    baseUrls: config.services.catalogUrls,
    path: `/api/products/${encodeURIComponent(productId)}`,
    authorization,
    notFoundMessage: `El producto ${productId} no existe en el catálogo`,
  });

  const valid =
    data &&
    typeof data.name === 'string' &&
    typeof data.active === 'boolean' &&
    typeof data.price === 'number' &&
    Number.isFinite(data.price) &&
    data.price >= 0;
  if (!valid) throw AppError.badGateway(`${DEPENDENCY} devolvió un producto fuera de contrato`, DEPENDENCY);

  return { id: productId, name: data.name, price: data.price, active: data.active };
}

module.exports = { getProduct };
