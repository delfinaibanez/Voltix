// ÚNICO punto de escritura del inventario.
//
// Toda modificación de stock o reservas (reserve, release, set stock) se expresa
// como un comando y se aplica con applyCommand(). La función es determinística:
// el resultado depende solo del comando y del estado actual de la base (sin
// Math.random, sin depender de la hora para decidir). Por eso, más adelante, Raft
// puede replicar el mismo comando a todos los nodos y cada uno llega al mismo
// estado llamando a applyCommand con ese comando.
//
// Esta función NO toma el lock: quien la llama (stock.service.js) es responsable
// de ejecutarla dentro de la sección crítica del producto.
//
// Comandos:
//   { type: 'SET_STOCK', productId, available }
//   { type: 'RESERVE',   productId, orderId, quantity }
//   { type: 'RELEASE',   productId, orderId }
//
// Devuelve { created, data }: created indica si se creó un recurso nuevo (201)
// o si se devolvió / modificó uno existente (200).

const config = require('../config/env');
const AppError = require('../utils/appError');
const { Stock } = require('../models/stock.model');
const { Reservation } = require('../models/reservation.model');

const COMMAND_TYPES = ['SET_STOCK', 'RESERVE', 'RELEASE'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retardo artificial entre la lectura y la escritura (DEMO_DELAY_MS). Sin lock,
// agranda la ventana en la que dos requests leen el mismo stock y las dos lo
// descuentan: así se ve la condición de carrera. No cambia el resultado.
async function demoDelay() {
  if (config.demoDelayMs > 0) await sleep(config.demoDelayMs);
}

async function findStockOr404(productId) {
  const stock = await Stock.findOne({ productId });
  if (!stock) throw AppError.notFound(`No hay stock registrado para el producto ${productId}`);
  return stock;
}

async function setStock({ productId, available }) {
  const existing = await Stock.findOne({ productId });
  await demoDelay();

  if (!existing) {
    const stock = await Stock.create({ productId, available, reserved: 0 });
    return { created: true, data: stock.toJSON() };
  }

  // Se fija la cantidad libre; lo que ya está reservado no se toca.
  existing.available = available;
  await existing.save();
  return { created: false, data: existing.toJSON() };
}

async function reserve({ productId, orderId, quantity }) {
  // Idempotencia por (orderId, productId): si la orden ya reservó este
  // producto, se devuelve la misma reserva sin descontar stock otra vez.
  const previous = await Reservation.findOne({ orderId, productId });
  if (previous) {
    if (previous.status === 'RELEASED') {
      throw AppError.conflict(
        `La reserva de la orden ${orderId} para el producto ${productId} ya fue liberada`,
      );
    }
    if (previous.quantity !== quantity) {
      throw AppError.conflict(
        `La orden ${orderId} ya reservó ${previous.quantity} unidades de este producto`,
        [{ field: 'quantity', message: `Debe coincidir con la reserva existente (${previous.quantity})` }],
      );
    }
    return { created: false, data: previous.toJSON() };
  }

  // Lectura -> decisión -> escritura (read-modify-write). Sin exclusión mutua,
  // dos requests concurrentes pueden leer el mismo "available" y sobrevender.
  const stock = await findStockOr404(productId);
  if (stock.available < quantity) {
    throw AppError.conflict('Stock insuficiente', [
      { field: 'quantity', message: `Disponible: ${stock.available}, solicitado: ${quantity}` },
    ]);
  }

  await demoDelay();

  stock.available -= quantity;
  stock.reserved += quantity;
  await stock.save();

  const reservation = await Reservation.create({ orderId, productId, quantity, status: 'RESERVED' });
  return { created: true, data: reservation.toJSON() };
}

async function release({ productId, orderId }) {
  const reservation = await Reservation.findOne({ orderId, productId });
  if (!reservation) {
    throw AppError.notFound(`No existe una reserva de la orden ${orderId} para el producto ${productId}`);
  }

  // Liberar dos veces no devuelve el stock dos veces (idempotente).
  if (reservation.status === 'RELEASED') {
    return { created: false, data: reservation.toJSON() };
  }

  const stock = await findStockOr404(productId);
  await demoDelay();

  stock.available += reservation.quantity;
  stock.reserved = Math.max(0, stock.reserved - reservation.quantity);
  await stock.save();

  reservation.status = 'RELEASED';
  await reservation.save();
  return { created: false, data: reservation.toJSON() };
}

const HANDLERS = { SET_STOCK: setStock, RESERVE: reserve, RELEASE: release };

async function applyCommand(command) {
  const handler = command && HANDLERS[command.type];
  if (!handler) {
    throw new Error(`Comando desconocido: ${command && command.type}. Válidos: ${COMMAND_TYPES.join(', ')}`);
  }
  return handler(command);
}

module.exports = { applyCommand, COMMAND_TYPES };
