const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { User } = require('../models/user.model');
const AppError = require('../utils/appError');
const config = require('../config/env');
const logger = require('../utils/logger');
const tokenService = require('./token.service');

// Hash ficticio: si el usuario no existe igual se compara, para que el tiempo
// de respuesta no revele si el email está registrado.
const DUMMY_HASH = bcrypt.hashSync('contraseña-ficticia', config.bcryptRounds);

async function register({ email, name, password }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const user = await User.create({ email, name, passwordHash, role: 'USER' });
  logger.info('Usuario registrado', { userId: user.id });
  return user;
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordMatches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  // Mismo mensaje y mismo status si falla el usuario o la contraseña.
  if (!user || !passwordMatches) {
    logger.warn('Login fallido', { email, reason: user ? 'bad_password' : 'unknown_user' });
    throw new AppError(401, 'Credenciales inválidas');
  }

  // Política documentada: cuenta deshabilitada -> 403 (solo se revela con credenciales correctas).
  if (!user.active) {
    logger.warn('Login rechazado: cuenta deshabilitada', { userId: user.id });
    throw new AppError(403, 'La cuenta está deshabilitada');
  }

  const { token, expiresIn } = tokenService.signAccessToken(user);
  logger.info('Login exitoso', { userId: user.id, role: user.role });
  return { accessToken: token, tokenType: 'Bearer', expiresIn };
}

// Comparación en tiempo constante (se comparan hashes para que el largo no filtre información).
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

// Emite el token técnico de un servicio (p. ej. orders-service) a cambio de su secreto.
async function issueServiceToken({ clientId, clientSecret }) {
  const expected = Object.hasOwn(config.serviceClients, clientId) ? config.serviceClients[clientId] : null;
  const matches = crypto.timingSafeEqual(sha256(clientSecret), sha256(expected ?? ''));
  if (!expected || !matches) {
    logger.warn('Token de servicio rechazado', { clientId });
    throw new AppError(401, 'Credenciales de servicio inválidas');
  }
  const { token, expiresIn } = tokenService.signServiceToken(clientId);
  logger.info('Token de servicio emitido', { clientId });
  return { accessToken: token, tokenType: 'Bearer', expiresIn };
}

async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user || !user.active) throw new AppError(401, 'La identidad del token ya no es válida');
  return user;
}

async function listUsers() {
  return User.find().sort({ createdAt: -1 }).limit(100);
}

module.exports = { register, login, issueServiceToken, getProfile, listUsers };