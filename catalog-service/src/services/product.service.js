const { Product } = require('../models/product.model');
const AppError = require('../utils/appError');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Valores que vuelve a tomar un campo opcional cuando un PUT no lo envía.
const OPTIONAL_DEFAULTS = { description: '', brand: undefined, imageUrl: undefined, active: true };

async function list({ page, limit, category, active, q, minPrice, maxPrice }) {
  const filter = {};
  if (category !== undefined) filter.category = category;
  if (active !== undefined) filter.active = active;
  if (q !== undefined) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = minPrice;
    if (maxPrice !== undefined) filter.price.$lte = maxPrice;
  }

  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter),
  ]);

  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function getById(id) {
  const product = await Product.findById(id);
  if (!product) throw AppError.notFound(`No existe un producto con id ${id}`);
  return product;
}

async function create(data) {
  return Product.create(data);
}

// PUT: reemplazo completo. Los campos obligatorios deben venir; los opcionales
// que se omiten vuelven a su valor por defecto.
async function replace(id, data) {
  const product = await getById(id);
  product.set({ ...OPTIONAL_DEFAULTS, ...data });
  return product.save();
}

// PATCH: modificación parcial, solo de los campos enviados.
async function update(id, data) {
  const product = await getById(id);
  product.set(data);
  return product.save();
}

async function remove(id) {
  const deleted = await Product.findByIdAndDelete(id);
  if (!deleted) throw AppError.notFound(`No existe un producto con id ${id}`);
}

module.exports = { list, getById, create, replace, update, remove };