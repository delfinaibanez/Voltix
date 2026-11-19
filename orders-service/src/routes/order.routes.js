const { Router } = require('express');
const controller = require('../controllers/order.controller');
const validateObjectId = require('../middlewares/validateObjectId');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

const router = Router();

// Todo requiere identidad. La propiedad (dueño o ADMIN) se resuelve en el service.
router.use(authenticate);

router.post('/', authorize('USER', 'ADMIN'), controller.create);
router.get('/', controller.list);
router.get('/:id', validateObjectId, controller.getById);
router.post('/:id/cancel', validateObjectId, controller.cancel);

module.exports = router;
