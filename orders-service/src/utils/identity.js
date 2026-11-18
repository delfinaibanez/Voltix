// Identidad del usuario autenticado, tal como la deja el middleware authenticate.
// Único punto a adaptar si el authenticate real de auth-service la deja en otra propiedad.
function getIdentity(req) {
  const user = req.user || {};
  return { id: user.id, role: user.role };
}

module.exports = { getIdentity };
