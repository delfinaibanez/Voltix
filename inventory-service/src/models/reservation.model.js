const mongoose = require('mongoose');

const RESERVATION_STATUS = ['RESERVED', 'RELEASED'];

// Reserva de stock hecha por una orden. Hay como máximo una por (orderId, productId):
// eso es lo que hace idempotente a POST /reserve.
const reservationSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: [true, 'orderId es obligatorio'],
      trim: true,
      maxlength: [64, 'orderId no puede superar los 64 caracteres'],
    },
    productId: {
      type: String,
      required: [true, 'productId es obligatorio'],
      match: [/^[0-9a-fA-F]{24}$/, 'productId debe ser un ObjectId de 24 caracteres hexadecimales'],
    },
    quantity: {
      type: Number,
      required: [true, 'quantity es obligatorio'],
      min: [1, 'quantity debe ser al menos 1'],
      validate: { validator: Number.isInteger, message: 'quantity debe ser un número entero' },
    },
    status: {
      type: String,
      enum: { values: RESERVATION_STATUS, message: `status debe ser uno de: ${RESERVATION_STATUS.join(', ')}` },
      default: 'RESERVED',
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      // Forma del contrato: { orderId, productId, quantity, status }
      transform: (doc, ret) => ({
        orderId: ret.orderId,
        productId: ret.productId,
        quantity: ret.quantity,
        status: ret.status,
      }),
    },
  },
);

reservationSchema.index({ orderId: 1, productId: 1 }, { unique: true });

const Reservation = mongoose.model('Reservation', reservationSchema);

module.exports = { Reservation, RESERVATION_STATUS };
