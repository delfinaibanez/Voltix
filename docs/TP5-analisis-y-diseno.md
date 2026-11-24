# Voltix: TP5 análisis y diseño de microservicios

Nov 24, 2026 · @delfina

## 1. Alcance y cómo leer este documento

Este documento reúne el análisis y diseño que justifica cómo se dividió la tienda Voltix en microservicios: qué hace la tienda, qué acoplamientos aparecen si se la piensa como una sola aplicación, dónde se trazaron los límites y cómo se comunican las partes.

**Nota de alcance:** no existió una aplicación monolítica previa que luego se separó. El análisis parte de la **aplicación de referencia**: la tienda tal como habría quedado si se construía como un único proyecto (una sola base de datos y un solo código). Con esa referencia se detectaron los acoplamientos y se decidió la separación. Este documento se redactó el 24 de noviembre de 2026, a partir del diseño y del código ya implementado; no pretende ser un registro de lo que se escribió durante el desarrollo. Lo que sí es verificable en el repositorio está marcado como tal (historial de Git, pruebas y evidencias en `docs/evidencias`).

**Servicios resultantes:** `catalog-service` (productos), `inventory-service` (stock y reservas, 3 nodos con Raft), `orders-service` (órdenes) y `auth-service` (usuarios y emisión de JWT, incorporado en TP7). Cada uno tiene su propia base MongoDB.

## 2. Inventario de funcionalidades de la tienda

La tienda ofrece 12 funcionalidades. En la aplicación de referencia (un solo proyecto con una sola base) todas compartirían tablas: la columna "Datos que toca" muestra esa dependencia, que es la que luego obliga a trazar límites. Los endpoints son los del sistema implementado.

| # | Funcionalidad | Endpoint | Reglas | Datos que toca en la app de referencia | Servicio que la resuelve |
| --- | --- | --- | --- | --- | --- |
| 1 | Registrar usuario | `POST /auth/register` | Email único (409). El rol no se elige: siempre USER. La contraseña se guarda con hash bcrypt y nunca se devuelve. | usuarios | auth |
| 2 | Iniciar sesión | `POST /auth/login` | Email inexistente y contraseña incorrecta dan el mismo 401. Devuelve un JWT HS256 de 1 hora. | usuarios | auth |
| 3 | Ver perfil y listar usuarios | `GET /auth/me`, `GET /auth/users` | Perfil: cualquier usuario autenticado. Listado: solo ADMIN. | usuarios | auth |
| 4 | Consultar el catálogo | `GET /api/products`, `GET /api/products/:id` | Público. Paginado, con filtros por categoría, texto, rango de precio y estado activo. | productos | catalog |
| 5 | Administrar productos | `POST`, `PUT`, `PATCH`, `DELETE /api/products` | Solo ADMIN. SKU único con formato fijo (409), precio entre 0 y 100.000.000, categoría de una lista cerrada. | productos | catalog |
| 6 | Consultar stock | `GET /api/stock/:productId` | Usuario autenticado. | stock | inventory |
| 7 | Ajustar stock | `PUT /api/stock/:productId` | Solo ADMIN. | stock | inventory |
| 8 | Reservar stock | `POST /api/stock/:productId/reserve` | Operación interna: solo orders-service (rol SERVICE). Idempotente por orden y producto. Stock insuficiente: 409. | stock, reservas | inventory |
| 9 | Liberar una reserva | `POST /api/stock/:productId/release` | Operación interna. Idempotente: liberar dos veces no devuelve el stock dos veces. | stock, reservas | inventory |
| 10 | Crear una orden | `POST /api/orders` | Nombre y precio salen del catálogo (si el cliente envía `unitPrice` o `userId`, 400). Total en centavos. Reserva ítem por ítem y, si uno falla, libera los anteriores. | usuarios, productos, stock, reservas, órdenes | orders (con catalog e inventory) |
| 11 | Consultar órdenes | `GET /api/orders`, `GET /api/orders/:id` | Un USER solo ve las suyas (403 si pide la ajena). ADMIN ve todas. | órdenes | orders |
| 12 | Cancelar una orden | `POST /api/orders/:id/cancel` | Solo el dueño o ADMIN. Libera el stock. Cancelar dos veces: 409. | órdenes, stock, reservas | orders (con inventory) |

Dependencias que importan para el diseño: las funcionalidades 10 y 12 son las únicas que cruzan datos de más de un dominio (productos, stock y órdenes). Todas las demás tocan un solo conjunto de datos y se pueden separar sin conflicto.

## 3. Acoplamientos detectados y cómo se resolvieron

Se identificaron cinco acoplamientos entre dominios en la aplicación de referencia. Los cuatro primeros se detectaron al decidir la separación; el quinto apareció recién con la separación ya hecha, en la revisión de seguridad de TP7, y se incluye porque es una consecuencia directa de partir el sistema.

| # | Acoplamiento | Cómo se manifestaría en la app de referencia | Riesgo | Cómo se resolvió | Dónde se comprueba |
| --- | --- | --- | --- | --- | --- |
| 1 | Órdenes leen datos de productos | La orden consulta la tabla de productos para tomar nombre y precio. | Un cambio en productos rompe órdenes, y el precio de una orden vieja cambiaría si el producto se modifica. | orders-service pide el producto a catalog-service por HTTP al crear la orden y guarda una copia (nombre y precio) dentro de la orden. El cliente no puede enviar el precio: si lo hace, 400. | Pruebas TP6: "precio y nombre tomados del catálogo" y rechazo de `unitPrice`. |
| 2 | Stock dentro del producto | El stock sería una columna de la tabla de productos. | Lecturas del catálogo y escrituras concurrentes de stock compiten por la misma fila, y los dos escalan distinto. | El stock pasa a inventory-service, que es su único dueño. El catálogo no conoce el stock. La relación es solo un `productId` lógico, sin clave foránea. El stock se protege con un lock de Redis por producto y se replica con Raft entre 3 nodos. | Prueba de carrera (`race-demo`) y pruebas de inventario en TP6. |
| 3 | Una transacción abarca orden y stock | Crear la orden y descontar stock ocurrirían en una sola transacción de base de datos. | Al separar las bases ya no hay transacción compartida: una falla a mitad de camino dejaría stock descontado sin orden. | Reservar y liberar son operaciones idempotentes por orden y producto. Si algo falla, orders libera lo ya reservado (compensación). Si la liberación también falla, queda guardada en Mongo y un proceso la reintenta hasta lograrla. | Pruebas de recuperación de inventario y de reconciliación de orders (TP6). |
| 4 | Órdenes referencian usuarios | `userId` sería una clave foránea a la tabla de usuarios, con joins para mostrar datos del dueño. | orders no podría funcionar si auth está caído, y compartirían esquema. | orders guarda solo el `userId`, tomado del campo `sub` del token. Valida la firma del JWT localmente, sin llamar a auth. El cliente no puede enviar `userId` en el body (400). | Pruebas TP6 y TP7: `userId` igual a `sub`, y el escenario J. |
| 5 | Operaciones internas expuestas | Reservar y liberar stock serían funciones internas, no accesibles por un usuario. | Al volverse endpoints HTTP, cualquier usuario autenticado podría llamarlos directo y saltear las reglas de Órdenes. | Solo los acepta la identidad técnica de orders-service (rol SERVICE), cuyo token emite auth-service a cambio de un secreto del servicio y dura 5 minutos. Un USER o un ADMIN recibe 403. | Pruebas TP7 H.2, H.3, I.3 a I.10 (31 PASS, `docs/evidencias`). |

## 4. Límites arquitectónicos y su justificación

Los límites se trazaron con cuatro criterios: cada dato tiene un solo dueño, cada servicio cambia por una sola razón, los datos que necesitan consistencia fuerte viven juntos, y la identidad se emite en un solo lugar.

| Servicio | Contexto que le pertenece | Por qué es un límite propio |
| --- | --- | --- |
| catalog-service | Productos: SKU, nombre, descripción, categoría, marca, precio, imagen y estado. | Es lectura intensa y casi sin concurrencia de escritura. Cambia cuando cambia la oferta comercial. Puede caerse sin que se pierda ningún dato de stock. |
| inventory-service | Stock disponible y reservado, y las reservas por orden. | Es el único dato donde dos compras simultáneas pueden pisarse. Necesita consistencia fuerte (lock por producto y consenso Raft entre 3 nodos) y por eso se escala y se protege distinto que el catálogo. |
| orders-service | Órdenes: ítems con copia del nombre y precio, total y estado. | Orquesta el caso de uso de compra, pero no es dueño de productos ni de stock: pide a otros y compensa si algo falla. |
| auth-service | Usuarios, contraseñas con hash y emisión de tokens (de usuario y de servicio). | La identidad se emite en un solo lugar; el resto solo valida la firma. |

**Por qué stock y reservas viven juntos en inventory.** Mantienen una regla en común: lo disponible más lo reservado no cambia al reservar o liberar. Si estuvieran en servicios distintos, esa regla requeriría una transacción distribuida.

**Qué no se separó y por qué.** No hay un servicio aparte para precios ni para usuarios de las órdenes: son un dato de producto y un dato de identidad, que ya tienen dueño. Pagos y envíos quedan fuera del alcance del proyecto.

**Qué se comparte entre servicios.** Solo el secreto con el que se firman los JWT (cada servicio valida la firma localmente) y los identificadores (`productId`, `orderId`, `userId`) como referencias lógicas, sin claves foráneas entre bases.

## 5. Fichas de definición de los servicios

Una ficha por servicio, con lo mismo en cada una: qué hace, qué reglas aplica, de qué depende y qué queda fuera. Los tres primeros son los microservicios de la tienda; auth-service se incorporó en TP7.

### catalog-service (puerto externo 4001, base catalog-db)

- **Responsabilidades:** alta, consulta, modificación y baja de productos; búsqueda paginada con filtros.
- **Reglas:** consulta pública; escritura solo ADMIN. SKU único (409) con formato de 3 a 30 caracteres. Precio entre 0 y 100.000.000. Categoría de una lista cerrada.
- **Datos propios:** productos.
- **Depende de:** solo su base. Valida el JWT localmente.
- **Lo consumen:** orders-service (para tomar nombre y precio) y el seed de inventory.
- **Fuera de alcance:** stock, precios históricos, imágenes almacenadas (solo guarda la URL), reseñas.

### inventory-service (puertos 4002, 4012 y 4022; 3 nodos, cada uno con su base)

- **Responsabilidades:** stock disponible y reservado por producto; reservar y liberar stock por orden.
- **Reglas:** consultar, cualquier usuario autenticado; ajustar, solo ADMIN; reservar y liberar, solo orders-service (rol SERVICE, 403 para el resto). Reserva idempotente por orden y producto; stock insuficiente da 409. Las escrituras exigen mayoría de nodos (2 de 3) y pasan por el líder; un nodo que no es líder redirige con 307 y, sin líder o sin quórum, responde 503.
- **Datos propios:** stock y reservas.
- **Depende de:** Redis (lock por producto), su base y los otros dos nodos (Raft). En ejecución no llama a otros servicios; solo el seed lee el catálogo.
- **Lo consumen:** orders-service.
- **Fuera de alcance:** conocer precios o nombres de productos, validar que el producto exista en el catálogo (lo hace orders antes de reservar), cantidad de nodos dinámica.

### orders-service (puerto 4003, base orders-db)

- **Responsabilidades:** crear, consultar y cancelar órdenes; coordinar con catálogo e inventario; compensar y reconciliar liberaciones fallidas.
- **Reglas:** nombre y precio salen del catálogo; el cliente no envía precio ni `userId` (400). Total en centavos. Un USER solo ve y cancela sus órdenes; ADMIN ve todas. Reserva ítem por ítem y libera lo ya reservado si uno falla. Cancelar dos veces da 409.
- **Datos propios:** órdenes y liberaciones pendientes de reconciliar.
- **Depende de:** catalog-service, inventory-service (prueba cada nodo una vez, con corte rápido de 2 segundos), auth-service (token de servicio) y su base.
- **Lo consumen:** los clientes (USER y ADMIN).
- **Fuera de alcance:** pagos, envíos, edición de una orden ya creada, reintentos automáticos de la compra mientras el cluster elige líder (devuelve 503 y el cliente reintenta).

### auth-service (puerto 4004, base auth-db)

- **Responsabilidades:** registro, inicio de sesión, perfil, listado de usuarios y emisión de tokens: JWT de usuario (1 hora) y token de servicio para orders (5 minutos).
- **Reglas:** email único; el rol no se elige al registrarse; contraseñas con hash bcrypt; el mismo 401 para email inexistente y contraseña incorrecta; el token de servicio solo se entrega a quien presenta el secreto del servicio.
- **Datos propios:** usuarios.
- **Depende de:** solo su base.
- **Lo consumen:** los clientes y orders-service. Los demás servicios no lo consultan: validan la firma por su cuenta.
- **Fuera de alcance:** renovación y revocación de tokens, recuperación de contraseña, verificación de email.

## 6. Matriz de propiedad de datos

Cada dato lo escribe un solo servicio. Los demás lo leen a través de su API o guardan solo una referencia lógica, nunca acceden a la base de otro.

| Dato | Dueño (único que escribe) | Quién lo usa | Cómo lo obtiene | Lo que guardan los demás |
| --- | --- | --- | --- | --- |
| Usuarios y contraseñas (hash) | auth-service | Clientes | Registro e inicio de sesión | Nadie. orders guarda solo el `userId`. |
| Productos | catalog-service | orders-service, seed de inventory | `GET /api/products/:id` | orders guarda una copia de nombre y precio dentro de cada ítem de la orden. |
| Stock disponible y reservado | inventory-service | orders-service (indirectamente), clientes (lectura) | `GET /api/stock/:productId` | Nadie. El catálogo no conoce el stock. |
| Reservas por orden | inventory-service | orders-service | `reserve` y `release` | orders guarda `orderId` y `productId`, que son las claves de la reserva. |
| Órdenes | orders-service | Clientes | `GET /api/orders` | Nadie. |
| Liberaciones pendientes de reconciliar | orders-service | orders-service | Proceso interno de reconciliación | Nadie. |
| Estado de Raft (término, voto, log) | Cada nodo de inventory, en su propia base | Los otros nodos de inventory | Llamadas de Raft entre nodos, con un token propio | Nadie. |
| Secreto de firma de JWT | Se comparte por configuración | auth, catalog, inventory, orders | Variable de entorno `JWT_SECRET` | Cada servicio valida la firma localmente. |

Las referencias entre servicios (`productId`, `orderId`, `userId`) son identificadores lógicos: no hay claves foráneas ni consultas entre bases. Si un identificador apunta a algo que ya no existe, el servicio dueño responde 404 y quien llama decide qué hacer.

## 7. Matriz de comunicación entre servicios

Toda la comunicación entre servicios es sincrónica (HTTP) y apunta en un solo sentido: orders llama a catalog, inventory y auth; ninguno de ellos llama a orders. No hay ciclos. Dentro de la red interna de Docker se usa HTTP; hacia afuera, solo HTTPS.

| Origen | Destino | Llamada | Credencial | Si el destino falla |
| --- | --- | --- | --- | --- |
| orders-service | catalog-service | `GET /api/products/:id` | JWT del usuario, reenviado | orders responde 503 nombrando a catalog y no crea la orden. Si el producto no existe, 404. |
| orders-service | inventory-service | `POST /api/stock/:productId/reserve` y `release` | Token de servicio (rol SERVICE) | Prueba cada nodo una vez y descarta los que responden 503. Sin líder o sin quórum, 503. Si falla a mitad de una compra, libera lo reservado; si la liberación también falla, queda pendiente y se reintenta sola. |
| orders-service | auth-service | `POST /auth/service-token` | Secreto del servicio | El token se reutiliza hasta 30 segundos antes de vencer. Si auth no responde, orders no puede reservar y devuelve error. |
| inventory (nodo) | inventory (otros nodos) | Llamadas de Raft: votos, latidos y replicación del log | Token de Raft, distinto del JWT | Sin mayoría de nodos (2 de 3) no hay líder y las escrituras dan 503. Las lecturas siguen funcionando. |
| inventory-service | Redis | Lock por producto (`SET NX PX 5000`, liberación con Lua) | Red interna | Sin Redis, reservar y liberar dan 503. |
| seed de inventory | catalog-service y auth-service | Lee productos y hace login como ADMIN | Credenciales del ADMIN | Solo afecta a la carga inicial de datos. |
| Cliente | Todos | HTTPS con JWT | Token de usuario | 401 si falta o es inválido, 403 si el rol no alcanza. |

catalog y auth no dependen de ningún otro servicio para funcionar. La caída y recuperación de catálogo e inventario se probó en TP6 (`docs/evidencias`), y el reinicio completo de Compose con auth en TP7.

## 8. Casos de uso distribuidos

Dos casos de uso atraviesan varios servicios: crear una orden y cancelarla. En ambos, orders-service coordina y los otros servicios son los dueños de sus datos.

### Caso 1: crear una orden

**Actores:** un usuario autenticado (USER o ADMIN), orders-service, catalog-service, auth-service e inventory-service (el nodo líder).

**Secuencia normal:**

1. El cliente envía `POST /api/orders` con la lista de productos y cantidades, y su JWT.
2. orders valida el JWT localmente y rechaza el pedido (400) si trae `unitPrice` o `userId`.
3. orders genera el identificador de la orden **antes** de reservar: es la clave de idempotencia de las reservas.
4. Por cada producto, orders pide a catalog `GET /api/products/:id` con el JWT del usuario y toma nombre y precio.
5. orders obtiene de auth su token de servicio (lo reutiliza mientras no venza).
6. Por cada producto, en orden, orders llama a inventory `POST /api/stock/:productId/reserve` con el token de servicio. Si el nodo consultado no es el líder, responde 307 y orders sigue la redirección.
7. inventory toma el lock del producto, propone la escritura a Raft, la confirma con mayoría de nodos y descuenta el stock.
8. orders calcula el total en centavos y guarda la orden en estado CONFIRMED con una copia de nombre y precio. Responde 201.

**Alternativas:**

- **Producto inexistente** (paso 4): catalog responde 404 y orders responde 404 sin haber reservado nada.
- **Stock insuficiente** (paso 6): inventory responde 409. orders libera lo que ya había reservado de los productos anteriores y responde 409.
- **Inventory sin líder o sin quórum** (paso 6): responde 503. orders compensa y devuelve 503; el cliente reintenta.
- **Falla al guardar la orden** (paso 8): orders libera todas las reservas.
- **La liberación también falla:** queda registrada en la base de orders y un proceso la reintenta cada pocos segundos, con espera creciente, hasta lograrla.

**Decisiones de diseño:**

- No hay transacción distribuida: se usa reserva idempotente más compensación, que es más simple y tolera que cada servicio tenga su base.
- El precio lo decide el catálogo y no el cliente, para que nadie pueda comprar a otro precio.
- El identificador de la orden se genera antes de reservar, para que reintentar una reserva no descuente dos veces.
- Se prioriza la consistencia del stock sobre la disponibilidad: sin quórum, inventory rechaza antes que arriesgar una sobreventa.

### Caso 2: cancelar una orden

**Actores:** el dueño de la orden o un ADMIN, orders-service e inventory-service.

**Secuencia normal:**

1. El cliente envía `POST /api/orders/:id/cancel` con su JWT.
2. orders busca la orden. Si no existe, 404. Si pertenece a otro usuario y quien llama no es ADMIN, 403. Si ya estaba cancelada, 409.
3. Por cada ítem, orders llama a inventory `POST .../release` con el token de servicio. inventory devuelve el stock a disponible y marca la reserva como liberada.
4. orders cambia el estado a CANCELLED con una sola operación atómica y responde 200.

**Alternativas:**

- **Inventory no responde** (paso 3): orders responde 503 y la orden **sigue CONFIRMED**. El cliente puede reintentar: liberar es idempotente.
- **Dos cancelaciones simultáneas:** solo una pasa el paso 4; la otra recibe 409. El stock no se devuelve dos veces porque la liberación es idempotente.
- **No había reserva para un ítem** (404 de inventory): se registra y se continúa.

**Decisiones de diseño:**

- Primero se libera el stock y después se cambia el estado de la orden. Si algo falla en el medio, la orden no queda cancelada con stock retenido: queda confirmada y se reintenta.
- Los permisos se aplican en orders: otro usuario no puede cancelar una orden ajena (403).

## 9. Checklist de validación de límites arquitectónicos

Cada punto se verificó contra el código y las pruebas del repositorio. La columna "Cómo se verifica" dice dónde mirar.

| # | Criterio | Cumple | Cómo se verifica |
| --- | --- | --- | --- |
| 1 | Cada servicio tiene su propia base de datos y ningún servicio accede a la base de otro. | Sí | `docker-compose.yml`: una base por servicio (cada nodo de inventory tiene la suya). |
| 2 | Cada dato tiene un solo servicio que lo escribe. | Sí | Sección 6, matriz de propiedad de datos. |
| 3 | No hay claves foráneas entre servicios: solo identificadores lógicos. | Sí | Modelos de orders e inventory (`productId`, `orderId`, `userId` como texto). |
| 4 | Los servicios solo se comunican por API HTTP. | Sí | Sección 7, matriz de comunicación. |
| 5 | No hay dependencias circulares entre servicios. | Sí | Solo orders llama a otros servicios; catalog, inventory y auth no llaman a orders. |
| 6 | Un servicio caído no tumba a los demás ni corrompe datos. | Sí | Pruebas de caída de catálogo e inventario: 503 claro y recuperación (`docs/evidencias/tp06-corrida-final-37-pass.txt`). |
| 7 | Un fallo a mitad de una operación entre servicios no deja datos inconsistentes. | Sí | Pruebas de recuperación de inventory y de reconciliación de orders (`npm run test:recovery`, `npm run test:reconciliation`). |
| 8 | Los datos sobreviven a la recreación de los contenedores. | Sí | `docs/evidencias/tp06-persistencia.txt` (12 PASS). |
| 9 | La identidad se emite en un solo lugar y las operaciones internas no son accesibles a usuarios. | Sí | Escenarios de seguridad A a L, 31 PASS (`docs/evidencias/tp07-corrida-final-31-pass.txt`). |
| 10 | Cada servicio se construye, configura y ejecuta de forma independiente (imagen propia, variables propias). | Sí | Un Dockerfile y un `.env.docker.example` por servicio. |
| 11 | Ningún secreto está en el repositorio. | Sí | Solo se versionan los `.env.docker.example` con valores de ejemplo; los `.env.docker` reales están ignorados por Git. |
| 12 | El precio de una compra no puede ser decidido por el cliente. | Sí | Prueba TP6: `unitPrice` enviado por el cliente da 400. |

**Limitaciones conocidas** (no son incumplimientos, pero conviene decirlas): el secreto de firma de JWT se comparte entre servicios, así que quien lo tenga podría emitir tokens (con claves asimétricas se evitaría); no hay renovación ni revocación de tokens; la compra no se reintenta sola mientras el cluster elige líder; el sistema no está desplegado en la nube.

## 10. Trazabilidad colaborativa

El trabajo se hizo en un repositorio compartido con ramas `feature/*`, Pull Requests siempre hacia `develop` y `main` como rama estable. Esta sección resume lo que se puede comprobar en el historial de Git al 24 de noviembre de 2026 (`git log --no-merges`); el detalle completo está en el repositorio.

| Integrante | Commits propios | Aporte comprobable en el historial |
| --- | --- | --- |
| Delfina Ibáñez | 13 (figura con dos grafías del nombre) | Repositorio inicial y estructura de servicios; catalog-service; auth-service (registro, login, JWT, roles); consenso Raft en inventory (TP4); configuración de `.gitignore` y limpieza del repo; README. Correcciones de TP6 y TP7: reservas recuperables ante cortes, reconciliación de liberaciones fallidas, identidad técnica de orders-service, evidencias de pruebas. |
| Candela Aguilar | 4 | inventory-service (stock, reservas idempotentes, lock distribuido con Redis); Dockerfiles y `docker-compose` con 3 nodos de inventory; variables de auth en los ejemplos de entorno; JWT en catalog e inventory y documentación de Docker. |
| Carolina  Fetta (commits como usuario de GitHub gcfetta) | 6 | orders-service (crear, consultar y cancelar órdenes); scripts de prueba de TP6 y TP7; JWT en orders-service; soporte de 3 nodos de inventory en las pruebas; respuesta 503 rápida cuando inventory no tiene nodos. |

Las fusiones de Pull Requests figuran a nombre de quien las aprobó: 18 de Delfina y 6 de Carolina
