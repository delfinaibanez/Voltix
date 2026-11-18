const AppError = require('./appError');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isObjectId = (value) => typeof value === 'string' && OBJECT_ID_REGEX.test(value);

function ensureObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw AppError.badRequest('El body debe ser un objeto JSON');
  }
}

function rejectUnknownFields(body, allowed, details) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      details.push({ field: key, message: 'Campo no permitido' });
    }
  }
}

function checkEmail(body, details) {
  if (typeof body.email !== 'string' || body.email.trim() === '') {
    details.push({ field: 'email', message: 'email es obligatorio' });
  } else if (body.email.length > 120 || !EMAIL_REGEX.test(body.email.trim())) {
    details.push({ field: 'email', message: 'email no tiene un formato válido' });
  }
}

// Registro: el rol NUNCA lo elige el cliente (siempre USER), por eso "role" es un campo no permitido.
function validateRegister(body) {
  ensureObject(body);
  const details = [];
  rejectUnknownFields(body, ['email', 'password', 'name'], details);

  checkEmail(body, details);

  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80) {
    details.push({ field: 'name', message: 'name es obligatorio (2 a 80 caracteres)' });
  }

  // bcrypt solo considera los primeros 72 bytes de la contraseña.
  if (typeof body.password !== 'string' || body.password.length < 8 || Buffer.byteLength(body.password) > 72) {
    details.push({ field: 'password', message: 'password es obligatorio (8 a 72 caracteres)' });
  }

  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);

  return {
    email: body.email.trim().toLowerCase(),
    name: body.name.trim(),
    password: body.password,
  };
}

function validateLogin(body) {
  ensureObject(body);
  const details = [];
  rejectUnknownFields(body, ['email', 'password'], details);

  checkEmail(body, details);

  if (typeof body.password !== 'string' || body.password === '') {
    details.push({ field: 'password', message: 'password es obligatorio' });
  }

  if (details.length > 0) throw AppError.badRequest('Datos inválidos', details);

  return { email: body.email.trim().toLowerCase(), password: body.password };
}

module.exports = { isObjectId, validateRegister, validateLogin };