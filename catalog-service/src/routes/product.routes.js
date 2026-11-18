const { Router } = require('express');
const controller = require('../controllers/product.controller');
const validateObjectId = require('../middlewares/validateObjectId');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

const router = Router();

// Solo ADMIN puede modificar el catálogo: primero se valida el token (401)
// y después el rol (403).
const adminOnly = [authenticate, authorize('ADMIN')];

// Lecturas públicas
router.get('/', controller.list);
router.get('/:id', validateObjectId, controller.getById);

// Escrituras
router.post('/', adminOnly, controller.create);
router.put('/:id', adminOnly, validateObjectId, controller.replace);
router.patch('/:id', adminOnly, validateObjectId, controller.update);
router.delete('/:id', adminOnly, validateObjectId, controller.remove);

module.exports = router;
