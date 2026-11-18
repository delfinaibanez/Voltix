// Usuarios de prueba reproducibles: npm run seed
// Las credenciales vienen del .env (nunca del código). Es idempotente: upsert por email.
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('./config/env');
const logger = require('./utils/logger');
const { connectWithRetry } = require('./config/db');
const { User } = require('./models/user.model');

const SEED_USERS = [
  {
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    name: 'Administrador Voltix',
    role: 'ADMIN',
  },
  {
    email: process.env.SEED_USER_EMAIL,
    password: process.env.SEED_USER_PASSWORD,
    name: 'Usuario de Prueba',
    role: 'USER',
  },
];

async function seed() {
  for (const u of SEED_USERS) {
    if (!u.email || !u.password) {
      throw new Error('Faltan SEED_ADMIN_* / SEED_USER_* en el .env (ver .env.example)');
    }
  }

  await connectWithRetry();
  await User.init();

  for (const { email, password, name, role } of SEED_USERS) {
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    await User.updateOne(
      { email: email.toLowerCase() },
      { $set: { name, role, active: true, passwordHash } },
      { upsert: true },
    );
    logger.info('Usuario de prueba listo', { email: email.toLowerCase(), role });
  }
}

seed()
  .catch((err) => {
    logger.error('Falló el seed de usuarios', { error: err.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    setTimeout(() => process.exit(), 300);
  });