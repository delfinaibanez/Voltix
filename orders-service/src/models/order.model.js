const mongoose = require('mongoose');

const ORDER_STATUS = ['CONFIRMED', 'CANCELLED'];

// Snapshot del producto al momento de la compra: el precio histórico no cambia
// aunque catalog-service modifique el producto después.
const itemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: [true, 'productId es obligatorio'],
      match: [/^[0-9a-fA-F]{24}$/, 'productId debe ser un ObjectId de 24 caracteres hexadecimales'],
    },
    name: { type: String, required: [true, 'name es obligatorio'], trim: true },
    unitPrice: { type: Number, required: [true, 'unitPrice es obligatorio'], min: [0, 'unitPrice no puede ser negativo'] },
    quantity: {
      type: Number,
      required: [true, 'quantity es obligatorio'],
      min: [1, 'quantity debe ser al menos 1'],
      validate: { validator: Number.isInteger, message: 'quantity debe ser un número entero' },
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    // Referencia lógica al usuario (sub del JWT): auth-service es el dueño del dato.
    userId: { type: String, required: [true, 'userId es obligatorio'], trim: true },
    items: {
      type: [itemSchema],
      validate: { validator: (items) => items.length > 0, message: 'La orden necesita al menos un ítem' },
    },
    total: { type: Number, required: [true, 'total es obligatorio'], min: [0, 'total no puede ser negativo'] },
    status: {
      type: String,
      enum: { values: ORDER_STATUS, message: `status debe ser uno de: ${ORDER_STATUS.join(', ')}` },
      default: 'CONFIRMED',
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => ({
        id: ret._id.toString(),
        userId: ret.userId,
        items: ret.items,
        total: ret.total,
        status: ret.status,
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
      }),
    },
  },
);

orderSchema.index({ userId: 1, createdAt: -1 });

const Order = mongoose.model('Order', orderSchema);

module.exports = { Order, ORDER_STATUS };
