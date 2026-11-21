const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

const router = Router();

router.post('/register', controller.register); // público
router.post('/login', controller.login); // público
router.post('/service-token', controller.serviceToken); // solo servicios con su secreto (orders-service)
router.get('/me', authenticate, controller.me); // cualquier usuario autenticado
router.get('/users', authenticate, authorize('ADMIN'), controller.listUsers); // solo ADMIN

module.exports = router;