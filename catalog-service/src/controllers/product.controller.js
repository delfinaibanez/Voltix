const productService = require('../services/product.service');
const { validateProductBody, parseListQuery } = require('../utils/validators');
const logger = require('../utils/logger');

// Express 5 captura automáticamente los errores de handlers async.

async function list(req, res) {
  const filters = parseListQuery(req.query);
  res.json(await productService.list(filters));
}

async function getById(req, res) {
  res.json(await productService.getById(req.params.id));
}

async function create(req, res) {
  const data = validateProductBody(req.body);
  const product = await productService.create(data);
  logger.info('Producto creado', { productId: product.id, sku: product.sku });
  res.status(201).location(`${req.baseUrl}/${product.id}`).json(product);
}

async function replace(req, res) {
  const data = validateProductBody(req.body);
  const product = await productService.replace(req.params.id, data);
  logger.info('Producto reemplazado', { productId: product.id });
  res.json(product);
}

async function update(req, res) {
  const data = validateProductBody(req.body, { partial: true });
  const product = await productService.update(req.params.id, data);
  logger.info('Producto modificado', { productId: product.id, fields: Object.keys(data) });
  res.json(product);
}

async function remove(req, res) {
  await productService.remove(req.params.id);
  logger.info('Producto eliminado', { productId: req.params.id });
  res.status(204).send();
}

module.exports = { list, getById, create, replace, update, remove };