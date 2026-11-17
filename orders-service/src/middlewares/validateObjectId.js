const AppError = require('../utils/appError');
const { isObjectId } = require('../utils/validators');

// Distingue un id mal formado (400) de un id válido que no existe (404).
function validateObjectId(req, res, next) {
  if (!isObjectId(req.params.id)) {
    throw AppError.badRequest('El id no tiene un formato válido', [
      { field: 'id', message: 'Debe ser un ObjectId de 24 caracteres hexadecimales' },
    ]);
  }
  next();
}

module.exports = validateObjectId;