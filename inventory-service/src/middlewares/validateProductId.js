const AppError = require('../utils/appError');
const { isObjectId } = require('../utils/validators');

// Distingue un productId mal formado (400) de uno válido sin stock (404).
function validateProductId(req, res, next) {
  if (!isObjectId(req.params.productId)) {
    throw AppError.badRequest('El productId no tiene un formato válido', [
      { field: 'productId', message: 'Debe ser un ObjectId de 24 caracteres hexadecimales' },
    ]);
  }
  next();
}

module.exports = validateProductId;
