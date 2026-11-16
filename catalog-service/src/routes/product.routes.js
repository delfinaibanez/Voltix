const { Router } = require('express');
const controller = require('../controllers/product.controller');
const validateObjectId = require('../middlewares/validateObjectId');

const router = Router();

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', validateObjectId, controller.getById);
router.put('/:id', validateObjectId, controller.replace);
router.patch('/:id', validateObjectId, controller.update);
router.delete('/:id', validateObjectId, controller.remove);

module.exports = router;