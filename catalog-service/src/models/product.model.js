const mongoose = require('mongoose');

const CATEGORIES = [
  'MOUSE',
  'TECLADO',
  'AURICULARES',
  'MONITOR',
  'WEBCAM',
  'ALMACENAMIENTO',
  'CABLES',
  'SOPORTES',
  'ACCESORIOS',
];

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'sku es obligatorio'],
      unique: true, // restricción de unicidad -> 409 Conflict
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9-]{3,30}$/, 'sku debe tener 3 a 30 caracteres (letras, números y guiones)'],
    },
    name: {
      type: String,
      required: [true, 'name es obligatorio'],
      trim: true,
      minlength: [2, 'name debe tener al menos 2 caracteres'],
      maxlength: [120, 'name no puede superar los 120 caracteres'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'description no puede superar los 1000 caracteres'],
      default: '',
    },
    category: {
      type: String,
      required: [true, 'category es obligatorio'],
      enum: { values: CATEGORIES, message: `category debe ser una de: ${CATEGORIES.join(', ')}` },
    },
    brand: {
      type: String,
      trim: true,
      maxlength: [60, 'brand no puede superar los 60 caracteres'],
    },
    price: {
      type: Number,
      required: [true, 'price es obligatorio'],
      min: [0, 'price no puede ser negativo'],
      max: [100000000, 'price excede el máximo permitido'],
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: [500, 'imageUrl no puede superar los 500 caracteres'],
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      // Identificador consistente hacia afuera: "id" (string) en lugar de "_id".
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  },
);

productSchema.index({ category: 1 });
productSchema.index({ name: 1 });

const Product = mongoose.model('Product', productSchema);

module.exports = { Product, CATEGORIES };