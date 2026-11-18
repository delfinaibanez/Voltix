// Error controlado: lleva el status HTTP que debe recibir el cliente.
class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message, details) {
    return new AppError(400, message, details);
  }

  static unauthorized(message = 'Token ausente o inválido') {
    return new AppError(401, message);
  }

  static forbidden(message = 'No tenés permisos para esta operación') {
    return new AppError(403, message);
  }

  static notFound(message) {
    return new AppError(404, message);
  }

  static conflict(message, details) {
    return new AppError(409, message, details);
  }

  // La dependencia respondió algo inesperado (5xx o respuesta fuera de contrato).
  static badGateway(message, dependency) {
    const err = new AppError(502, message);
    err.dependency = dependency;
    return err;
  }

  // La dependencia no respondió (red, DNS, timeout). retryAfter va en el header Retry-After.
  static serviceUnavailable(message, { dependency, retryAfter = 2 } = {}) {
    const err = new AppError(503, message);
    err.dependency = dependency;
    err.retryAfter = retryAfter;
    return err;
  }
}

module.exports = AppError;
