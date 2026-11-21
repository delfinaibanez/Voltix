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

// Operaciones sobre el stock y su reserva, pensadas para que un corte a la mitad
// (se cae el proceso o Mongo entre dos escrituras) se pueda reintentar sin dejar
// datos inconsistentes. Raft reaplica una entrada si no llegó a marcarla como aplicada,
// así que cada comando tiene que dar el mismo resultado si se ejecuta dos veces.
//
// Cómo se logra, sin transacciones (Mongo corre como nodo único):
//   1. Se registra la intención: la reserva queda en estado PENDING.
//   2. El stock se modifica con UNA sola operación atómica que además deja una marca
//      ("reserve:<orderId>") en el mismo documento. Si la marca ya está, no se vuelve
//      a descontar.
//   3. Recién ahí la reserva pasa a RESERVED y se borra la marca.
// Si se corta entre dos pasos, al reintentar se detecta en cuál quedó y se continúa.

const hasOp = (stock, key) => Boolean(stock) && (stock.appliedOps || []).includes(key);

const stockWith = (productId) => Stock.findOne({ productId }).select('+appliedOps');

const clearOps = (productId, ...keys) =>
  Stock.updateOne({ productId }, { $pull: { appliedOps: { $in: keys } } });

async function reserve({ productId, orderId, quantity }) {
  const reserveKey = `reserve:${orderId}`;

  // Idempotencia por (orderId, productId): si la orden ya reservó este producto se
  // devuelve la misma reserva sin descontar stock otra vez.
  let reservation = await Reservation.findOne({ orderId, productId });
  if (reservation) {
    if (reservation.status === 'RELEASED') {
      throw AppError.conflict(
        `La reserva de la orden ${orderId} para el producto ${productId} ya fue liberada`,
      );
    }
    if (reservation.quantity !== quantity) {
      throw AppError.conflict(
        `La orden ${orderId} ya reservó ${reservation.quantity} unidades de este producto`,
        [{ field: 'quantity', message: `Debe coincidir con la reserva existente (${reservation.quantity})` }],
      );
    }
  }

  const stock = await stockWith(productId);
  if (!stock) throw AppError.notFound(`No hay stock registrado para el producto ${productId}`);

  // Reserva ya terminada: solo se limpia una marca que pudiera haber quedado.
  if (reservation && reservation.status === 'RESERVED') {
    if (hasOp(stock, reserveKey)) await clearOps(productId, reserveKey);
    return { created: false, data: reservation.toJSON() };
  }

  const alreadyDiscounted = hasOp(stock, reserveKey); // se cortó después de descontar

  if (!alreadyDiscounted && stock.available < quantity) {
    if (reservation) await Reservation.deleteOne({ orderId, productId, status: 'PENDING' });
    throw AppError.conflict('Stock insuficiente', [
      { field: 'quantity', message: `Disponible: ${stock.available}, solicitado: ${quantity}` },
    ]);
  }

  // Paso 1: intención registrada.
  const isNew = !reservation;
  if (isNew) reservation = await Reservation.create({ orderId, productId, quantity, status: 'PENDING' });

  await demoDelay();

  // Paso 2: descuento atómico + marca. Con lock activo exige stock suficiente en la misma
  // operación; con el lock apagado (solo la demo de carrera) no, para poder ver la sobreventa.
  if (!alreadyDiscounted) {
    const guard = config.lock.enabled ? { available: { $gte: quantity } } : {};
    const result = await Stock.updateOne(
      { productId, appliedOps: { $ne: reserveKey }, ...guard },
      { $inc: { available: -quantity, reserved: quantity }, $push: { appliedOps: reserveKey } },
    );
    if (result.modifiedCount === 0) {
      const current = await stockWith(productId);
      if (!hasOp(current, reserveKey)) {
        await Reservation.deleteOne({ orderId, productId, status: 'PENDING' });
        throw AppError.conflict('Stock insuficiente', [
          { field: 'quantity', message: `Disponible: ${current ? current.available : 0}, solicitado: ${quantity}` },
        ]);
      }
    }
  }

  // Paso 3: la reserva queda confirmada y se limpia la marca.
  reservation.status = 'RESERVED';
  await Reservation.updateOne({ orderId, productId }, { status: 'RESERVED' });
  await clearOps(productId, reserveKey);
  return { created: isNew, data: reservation.toJSON() };
}

async function release({ productId, orderId }) {
  const reserveKey = `reserve:${orderId}`;
  const releaseKey = `release:${orderId}`;

  const reservation = await Reservation.findOne({ orderId, productId });
  if (!reservation) {
    throw AppError.notFound(`No existe una reserva de la orden ${orderId} para el producto ${productId}`);
  }

  const stock = await stockWith(productId);
  if (!stock) throw AppError.notFound(`No hay stock registrado para el producto ${productId}`);

  // Liberar dos veces no devuelve el stock dos veces (idempotente).
  if (reservation.status === 'RELEASED') {
    await clearOps(productId, releaseKey, reserveKey);
    return { created: false, data: reservation.toJSON() };
  }

  // Reserva cortada antes de descontar el stock: no hay nada que devolver.
  const neverDiscounted = reservation.status === 'PENDING' && !hasOp(stock, reserveKey);

  await demoDelay();

  if (!neverDiscounted) {
    // Devolución atómica + marca: si ya está la marca, no se devuelve de nuevo.
    await Stock.updateOne(
      { productId, appliedOps: { $ne: releaseKey } },
      {
        $inc: { available: reservation.quantity, reserved: -reservation.quantity },
        $push: { appliedOps: releaseKey },
      },
    );
  }

  reservation.status = 'RELEASED';
  await Reservation.updateOne({ orderId, productId }, { status: 'RELEASED' });
  await clearOps(productId, releaseKey, reserveKey);
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
