const mongoose = require('mongoose');
const { Order } = require('../models/order.model');
const catalog = require('../clients/catalog.client');
const inventory = require('../clients/inventory.client');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const reconciliation = require('./reconciliation.service');

const isAdmin = (identity) => identity.role === 'ADMIN';
// Tras estos errores no se sabe si inventory llegó a aplicar la reserva.
const AMBIGUOUS_STATUS = new Set([502, 503]);

// 1) Catálogo: el producto debe existir y estar activo; el precio sale de acá, nunca del cliente.
async function resolveLines(items, authorization) {
  const lines = [];
  for (const [index, item] of items.entries()) {
    const product = await catalog.getProduct(item.productId, authorization);
    if (!product.active) {
      throw AppError.conflict(`El producto ${item.productId} no está disponible (inactivo)`, [
        { field: `items[${index}].productId`, message: 'Producto inactivo' },
      ]);
    }
    lines.push({ productId: item.productId, name: product.name, unitPrice: product.price, quantity: item.quantity });
  }
  return lines;
}

// Compensación: libera las reservas ya hechas. Nunca lanza: si una liberación falla
// se guarda como pendiente y la reconciliación automática la reintenta hasta lograrla.
async function releaseAll(orderId, productIds, reason) {
  for (const productId of [...productIds].reverse()) {
    try {
      await inventory.release(productId, orderId);
      logger.info('Reserva liberada (compensación)', { orderId, productId, reason });
    } catch (err) {
      if (err.statusCode === 404) continue; // nunca llegó a reservarse
      logger.error('Compensación fallida: reserva sin liberar', {
        orderId,
        productId,
        reason,
        status: err.statusCode,
        cause: err.message,
      });
      await reconciliation.enqueue({ orderId, productId, reason, cause: err.message });
    }
  }
}

async function createOrder(identity, items, authorization) {
  const _id = new mongoose.Types.ObjectId();
  const orderId = _id.toString(); // se genera antes de reservar: es la clave de idempotencia
  const lines = await resolveLines(items, authorization);

  const reserved = [];
  let inFlight = null;
  try {
    // 2) Inventario: reserva ítem por ítem con el mismo orderId.
    for (const line of lines) {
      inFlight = line.productId;
      try {
        await inventory.reserve(line.productId, { orderId, quantity: line.quantity });
      } catch (err) {
        if (err.statusCode === 409) {
          throw AppError.conflict(`${err.message} (producto ${line.productId})`, err.details);
        }
        throw err;
      }
      reserved.push(line.productId);
      inFlight = null;
    }

    // 3) Persistencia propia, en centavos para no arrastrar errores de punto flotante.
    const total = lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0) / 100;
    return await Order.create({ _id, userId: identity.id, items: lines, total, status: 'CONFIRMED' });
  } catch (err) {
    const toRelease = inFlight && AMBIGUOUS_STATUS.has(err.statusCode) ? [...reserved, inFlight] : reserved;
    logger.warn('Creación de orden abortada: se compensa el stock', {
      orderId,
      status: err.statusCode,
      toRelease: toRelease.length,
    });
    await releaseAll(orderId, toRelease, 'create-failed');
    throw err;
  }
}

async function listOrders(identity, { page, limit }) {
  const filter = isAdmin(identity) ? {} : { userId: identity.id };
  const [data, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);
  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}

// Propiedad del recurso (TP7 11.2): dueño o ADMIN; otro usuario -> 403.
async function getAccessibleOrder(identity, id) {
  const order = await Order.findById(id);
  if (!order) throw AppError.notFound(`No existe la orden ${id}`);
  if (!isAdmin(identity) && order.userId !== identity.id) {
    throw AppError.forbidden('No tenés permisos para acceder a esta orden');
  }
  return order;
}

async function cancelOrder(identity, id) {
  const order = await getAccessibleOrder(identity, id);
  if (order.status === 'CANCELLED') throw AppError.conflict(`La orden ${id} ya estaba cancelada`);

  // Primero se libera el stock; si alguna liberación falla la orden sigue CONFIRMED y se
  // puede reintentar (release es idempotente en inventory).
  for (const item of order.items) {
    try {
      await inventory.release(item.productId, id);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      logger.warn('Cancelación: no había reserva para liberar', { orderId: id, productId: item.productId });
    }
  }

  // Transición atómica: si dos cancelaciones compiten, solo una gana y la otra recibe 409.
  const cancelled = await Order.findOneAndUpdate(
    { _id: order._id, status: 'CONFIRMED' },
    { status: 'CANCELLED' },
    { new: true },
  );
  if (!cancelled) throw AppError.conflict(`La orden ${id} ya estaba cancelada`);
  return cancelled;
}

module.exports = { createOrder, listOrders, getAccessibleOrder, cancelOrder };
