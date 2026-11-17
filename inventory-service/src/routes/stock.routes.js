const { Router } = require('express');
const controller = require('../controllers/stock.controller');
const validateProductId = require('../middlewares/validateProductId');
const { authenticate, authorize } = require('../middlewares/auth');

const router = Router();

router.get('/:productId', validateProductId, controller.getStock);
router.put('/:productId', authenticate, authorize('ADMIN'), validateProductId, controller.setStock);
router.post('/:productId/reserve', authenticate, validateProductId, controller.reserve);
router.post('/:productId/release', authenticate, validateProductId, controller.release);

module.exports = router;
