const AppError = require('../utils/appError');

// Escritura recibida por un follower: se rechaza e informa quién es el líder.
//   - Líder conocido con URL -> 307 + Location (el cliente repite la misma
//     request, con método y body, contra el líder). El errorHandler elige la URL:
//     HTTPS recibido por el puerto público -> publicUrl; HTTP de la red interna
//     (por ejemplo orders-service) -> internalUrl.
//   - Líder conocido sin URL -> 503 con el id del líder en el body.
//   - Sin líder (elección en curso) -> 503 con Retry-After.
function notLeader(leaderId, { publicUrl, internalUrl } = {}) {
  if (leaderId && (publicUrl || internalUrl)) {
    const err = new AppError(307, `Este nodo no es el líder. Repetí la escritura en el líder (${leaderId})`);
    err.leader = { id: leaderId, publicUrl, internalUrl };
    return err;
  }
  if (leaderId) {
    const err = AppError.serviceUnavailable(`Este nodo no es el líder. El líder actual es ${leaderId}`, 1);
    err.leader = { id: leaderId };
    return err;
  }
  return AppError.serviceUnavailable('Todavía no hay un líder elegido. Reintentá en unos segundos', 2);
}

module.exports = { notLeader };