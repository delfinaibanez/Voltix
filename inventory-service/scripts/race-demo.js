// Demo de condición de carrera y exclusión mutua (TP2).
//
// Dispara N reservas simultáneas (cada una de una orden distinta) contra un
// producto con poco stock y muestra cuántas se aceptaron y cómo quedó el stock.
//
// Uso (con el servicio corriendo):
//   1) SIN lock -> en .env: LOCK_ENABLED=false y DEMO_DELAY_MS=200, reiniciar el servicio
//      node scripts/race-demo.js --product <productId>
//      Resultado esperado: se aceptan más reservas que el stock (sobreventa).
//   2) CON lock -> en .env: LOCK_ENABLED=true (DEMO_DELAY_MS=200), reiniciar el servicio
//      node scripts/race-demo.js --product <productId>
//      Resultado esperado: se aceptan exactamente "stock" reservas; el resto 409.
//
// Opciones:
//   --url      URL base del servicio   (default: INVENTORY_URL o http://localhost:3002)
//   --product  productId a usar        (obligatorio; el stock se crea si no existe)
//   --n        reservas simultáneas    (default: 20)
//   --stock    stock inicial           (default: 5)
//   --qty      unidades por reserva    (default: 1)
//   --token    JWT de ADMIN            (default: TOKEN; fija el stock inicial)
//   --service-token  JWT de servicio (rol SERVICE, el de orders-service) para reservar
//                                      (default: SERVICE_TOKEN; reservar es una operación interna)
//   --label    texto para identificar la corrida en la salida

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const BASE_URL = (args.url || process.env.INVENTORY_URL || 'http://localhost:3002').replace(/\/+$/, '');
const PRODUCT_ID = args.product;
const N = Number(args.n || 20);
const INITIAL_STOCK = Number(args.stock || 5);
const QTY = Number(args.qty || 1);
const TOKEN = args.token || process.env.TOKEN;
const SERVICE_TOKEN = args['service-token'] || process.env.SERVICE_TOKEN || TOKEN;
const LABEL = args.label || '';

if (!/^[0-9a-fA-F]{24}$/.test(PRODUCT_ID || '')) {
  console.error('Falta --product <productId> (ObjectId de 24 caracteres hexadecimales)');
  process.exit(1);
}

// Cada llamada usa el token que le corresponde: ADMIN para fijar/consultar stock,
// SERVICE para reservar.
async function call(method, path, body, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  // 1) Stock inicial conocido.
  const set = await call('PUT', `/api/stock/${PRODUCT_ID}`, { available: INITIAL_STOCK });
  if (set.status >= 300) {
    console.error('No se pudo fijar el stock inicial:', set.status, set.data);
    process.exit(1);
  }
  const before = set.data;

  // 2) N reservas al mismo tiempo, cada una de una orden distinta.
  const runId = Date.now().toString(36);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      call('POST', `/api/stock/${PRODUCT_ID}/reserve`, { orderId: `demo-${runId}-${i + 1}`, quantity: QTY }, SERVICE_TOKEN),
    ),
  );
  const elapsed = Date.now() - started;

  // 3) Estado final.
  const after = (await call('GET', `/api/stock/${PRODUCT_ID}`)).data;

  const count = (status) => results.filter((r) => r.status === status).length;
  const accepted = count(201);
  const unitsSold = accepted * QTY;
  const maxPossible = Math.floor(INITIAL_STOCK / QTY);
  const otherStatuses = results
    .map((r) => r.status)
    .filter((s) => ![201, 409, 503].includes(s));

  console.log('');
  console.log(`=== Demo de carrera ${LABEL}`.trim());
  console.log(`Servicio:              ${BASE_URL}`);
  console.log(`Producto:              ${PRODUCT_ID}`);
  console.log(`Stock inicial:         available=${before.available}, reserved=${before.reserved}`);
  console.log(`Reservas simultáneas:  ${N} x ${QTY} unidad(es)  (${elapsed} ms)`);
  console.log('');
  console.log(`201 aceptadas:         ${accepted}   (máximo correcto: ${maxPossible})`);
  console.log(`409 sin stock:         ${count(409)}`);
  console.log(`503 lock/Redis:        ${count(503)}`);
  if (otherStatuses.length > 0) console.log(`Otros:                 ${otherStatuses.join(', ')}`);
  console.log('');
  console.log(`Stock final:           available=${after.available}, reserved=${after.reserved}`);
  console.log(`Unidades vendidas:     ${unitsSold} de ${INITIAL_STOCK} disponibles`);
  console.log('');

  const oversold = unitsSold > INITIAL_STOCK;
  const inconsistent = after.reserved !== before.reserved + unitsSold ||
    after.available + after.reserved !== before.available + before.reserved;

  if (oversold || inconsistent) {
    console.log('RESULTADO: CONDICIÓN DE CARRERA');
    if (oversold) console.log(`  - Se vendieron ${unitsSold - INITIAL_STOCK} unidades de más (sobreventa).`);
    if (inconsistent) {
      console.log('  - El stock no cuadra con las reservas aceptadas (actualizaciones perdidas).');
    }
  } else {
    console.log('RESULTADO: CORRECTO (sin sobreventa; available + reserved se conserva)');
  }
  console.log('');
}

main().catch((err) => {
  console.error('Error en la demo:', err.message);
  console.error(`¿Está corriendo inventory-service en ${BASE_URL}?`);
  process.exit(1);
});
