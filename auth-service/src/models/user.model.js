const mongoose = require('mongoose');

const ROLES = ['USER', 'ADMIN'];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'email es obligatorio'],
      unique: true, // un email = una identidad -> 409 Conflict
      trim: true,
      lowercase: true,
      maxlength: [120, 'email no puede superar los 120 caracteres'],
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'email no tiene un formato válido'],
    },
    name: {
      type: String,
      required: [true, 'name es obligatorio'],
      trim: true,
      minlength: [2, 'name debe tener al menos 2 caracteres'],
      maxlength: [80, 'name no puede superar los 80 caracteres'],
    },
    // Solo se guarda el hash. select:false evita traerlo en consultas normales.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: { values: ROLES, message: `role debe ser uno de: ${ROLES.join(', ')}` },
      default: 'USER',
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
      // Nunca se devuelve el hash. Identificador consistente: "id".
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES };