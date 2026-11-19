// Identidad del usuario autenticado, tal como la deja el middleware authenticate
// (copiado de auth-service): req.user = { id: sub del token, role }.
// El dueño de una orden SIEMPRE sale de acá, nunca del body ni de la query.
function getIdentity(req) {
  const user = req.user || {};
  return { id: user.id, role: user.role };
}

module.exports = { getIdentity };
