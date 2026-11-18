const authService = require('../services/auth.service');
const { validateRegister, validateLogin } = require('../utils/validators');

// Express 5 captura automáticamente los errores de handlers async.

async function register(req, res) {
  const data = validateRegister(req.body);
  const user = await authService.register(data);
  res.status(201).location(`${req.baseUrl}/users/${user.id}`).json(user);
}

async function login(req, res) {
  const credentials = validateLogin(req.body);
  res.json(await authService.login(credentials));
}

async function me(req, res) {
  res.json(await authService.getProfile(req.user.id));
}

async function listUsers(req, res) {
  res.json({ data: await authService.listUsers() });
}

module.exports = { register, login, me, listUsers };