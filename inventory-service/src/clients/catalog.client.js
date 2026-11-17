const config = require('../config/env');

// Cliente HTTP de catalog-service (fetch nativo). La URL sale de
// CATALOG_SERVICE_URL: nunca se fija un localhost en el código.
async function listProducts({ page = 1, limit = 100 } = {}) {
  if (!config.services.catalogUrl) {
    throw new Error('Falta la variable CATALOG_SERVICE_URL');
  }

  const url = `${config.services.catalogUrl}/api/products?page=${page}&limit=${limit}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(config.services.timeoutMs) });
  } catch (err) {
    throw new Error(`No se pudo conectar con catalog-service (${url}): ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`catalog-service respondió ${response.status} en ${url}`);
  }
  return response.json(); // { data, page, limit, total, totalPages }
}

// Recorre todas las páginas del catálogo.
async function listAllProducts() {
  const products = [];
  for (let page = 1; ; page += 1) {
    const result = await listProducts({ page, limit: 100 });
    products.push(...result.data);
    if (page >= result.totalPages || result.data.length === 0) break;
  }
  return products;
}

module.exports = { listProducts, listAllProducts };
