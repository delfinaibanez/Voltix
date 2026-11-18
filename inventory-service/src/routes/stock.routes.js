const { Router } = require('express');
const controller = require('../controllers/stock.controller');
const validateProductId = require('../middlewares/validateProductId');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

const router = Router();

// Todas las rutas exigen token válido (401). orders-service reenvía el token
// del usuario, así que reservar y liberar lo pueden hacer USER o ADMIN.
// Ajustar stock directamente (PUT) es solo ADMIN (403).
router.use(authenticate);

router.get('/:productId', validateProductId, controller.getStock);
router.put('/:productId', authorize('ADMIN'), validateProductId, controller.setStock);
router.post('/:productId/reserve', authorize('USER', 'ADMIN'), validateProductId, controller.reserve);
router.post('/:productId/release', authorize('USER', 'ADMIN'), validateProductId, controller.release);

module.exports = router;
