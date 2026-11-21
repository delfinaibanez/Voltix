const { Router } = require('express');
const controller = require('../controllers/stock.controller');
const validateProductId = require('../middlewares/validateProductId');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

const router = Router();

// Todas las rutas exigen token válido (401).
//   - Consultar stock (GET): cualquier identidad autenticada.
//   - Ajustar stock (PUT): solo ADMIN.
//   - Reservar / liberar: operaciones internas, solo la identidad técnica de
//     orders-service (rol SERVICE, emitida por auth-service). Un USER o un ADMIN
//     que las llame directo recibe 403: así no se saltea las reglas de Órdenes.
router.use(authenticate);

router.get('/:productId', validateProductId, controller.getStock);
router.put('/:productId', authorize('ADMIN'), validateProductId, controller.setStock);
router.post('/:productId/reserve', authorize('SERVICE'), validateProductId, controller.reserve);
router.post('/:productId/release', authorize('SERVICE'), validateProductId, controller.release);

module.exports = router;
