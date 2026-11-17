const mongoose = require('mongoose');

const integer = (field) => ({
  validator: Number.isInteger,
  message: `${field} debe ser un número entero`,
});

// Stock de un producto del catálogo.
//   available: unidades libres para vender.
//   reserved:  unidades apartadas por órdenes confirmadas (todavía no liberadas).
const stockSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: [true, 'productId es obligatorio'],
      unique: true, // un único documento de stock por producto
      match: [/^[0-9a-fA-F]{24}$/, 'productId debe ser un ObjectId de 24 caracteres hexadecimales'],
    },
    available: {
      type: Number,
      required: true,
      min: [0, 'available no puede ser negativo'],
      validate: integer('available'),
      default: 0,
    },
    reserved: {
      type: Number,
      required: true,
      min: [0, 'reserved no puede ser negativo'],
      validate: integer('reserved'),
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      // Forma del contrato: { productId, available, reserved }
      transform: (doc, ret) => ({
        productId: ret.productId,
        available: ret.available,
        reserved: ret.reserved,
      }),
    },
  },
);

const Stock = mongoose.model('Stock', stockSchema);

module.exports = { Stock };
