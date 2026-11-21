// Pruebas de recuperación de stock.commands (TP6): si el proceso se corta entre dos
// escrituras, reintentar el mismo comando deja stock y reserva consistentes y no
// descuenta ni devuelve dos veces. Usa un Stock/Reservation en memoria que puede
// "cortarse" en la escritura N (no necesita Mongo ni Docker).
//
//   cd inventory-service && npm run test:recovery
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const SRC = path.resolve(__dirname, '..', 'src');
const R = (p) => require.resolve(path.join(SRC, p));
let stocks=[], resv=[]; let failAt=null, counter=0;
const tick=(label)=>{ counter++; if(failAt===counter) throw new Error('CORTE en '+label); };
const clone=(o)=>JSON.parse(JSON.stringify(o));
function match(doc,f){return Object.entries(f).every(([k,v])=>{
  if(k==='appliedOps'&&v&&v.$ne!==undefined) return !doc.appliedOps.includes(v.$ne);
  if(v&&typeof v==='object'&&v.$gte!==undefined) return doc[k]>=v.$gte;
  return doc[k]===v;});}
const mk=(doc,extra={})=>doc&&Object.assign(Object.create({toJSON(){const {orderId,productId,quantity,status,available,reserved}=this;return this.available!==undefined?{productId,available,reserved}:{orderId,productId,quantity,status};}}),doc,extra);
const Stock={
  findOne:(f)=>{const d=stocks.find(x=>match(x,f));const o=mk(d);const p=Promise.resolve(o);p.select=()=>Promise.resolve(o&&mk(clone(d),{}));return p;},
  updateOne:async(f,u)=>{tick('Stock.updateOne');const d=stocks.find(x=>match(x,f));if(!d)return{modifiedCount:0};
    for(const [k,v] of Object.entries(u.$inc||{})) d[k]+=v; for(const [k,v] of Object.entries(u.$push||{})) d[k].push(v);
    for(const [k,v] of Object.entries(u.$pull||{})) d[k]=d[k].filter(x=>!v.$in.includes(x)); return{modifiedCount:1};}};
const Reservation={
  findOne:async(f)=>{const d=resv.find(x=>match(x,f));return d&&mk(d);},
  create:async(doc)=>{tick('Reservation.create');resv.push(clone(doc));return mk(resv[resv.length-1]);},
  updateOne:async(f,u)=>{tick('Reservation.updateOne');const d=resv.find(x=>match(x,f));Object.assign(d,u);return{modifiedCount:1};},
  deleteOne:async(f)=>{tick('Reservation.deleteOne');resv=resv.filter(x=>!match(x,f));}};
const put=(p,e)=>{const r=R(p);require.cache[r]={id:r,filename:r,loaded:true,exports:e};};
put('models/stock.model.js',{Stock}); put('models/reservation.model.js',{Reservation});
process.env.JWT_SECRET='a'.repeat(40); process.env.LOG_TO_FILES='false'; process.env.RAFT_ENABLED='false';
const {applyCommand}=require(path.join(SRC, 'services/stock.commands.js'));
const reset=()=>{stocks=[{productId:'p1',available:10,reserved:0,appliedOps:[]}];resv=[];};
const snap=()=>({a:stocks[0].available,r:stocks[0].reserved,ops:stocks[0].appliedOps.length,res:resv.map(x=>x.status)});

const reserveCmd = { type: 'RESERVE', productId: 'p1', orderId: 'o1', quantity: 3 };
const releaseCmd = { type: 'RELEASE', productId: 'p1', orderId: 'o1' };

test('reserve: corte en cada escritura y reintento -> queda reservado una sola vez', async () => {
  for (let n = 1; n <= 4; n += 1) {
    reset(); counter = 0; failAt = n;
    await assert.rejects(applyCommand(reserveCmd), /CORTE/, `debía cortarse en la escritura ${n}`);
    failAt = null;
    await applyCommand(reserveCmd);
    assert.deepEqual(snap(), { a: 7, r: 3, ops: 0, res: ['RESERVED'] }, `corte ${n}`);
    await applyCommand(reserveCmd); // repetido: idempotente
    assert.equal(snap().a, 7, `repetido tras corte ${n}`);
  }
});

test('release: corte en cada escritura y reintento -> se devuelve una sola vez', async () => {
  for (let n = 1; n <= 3; n += 1) {
    reset(); failAt = null;
    await applyCommand(reserveCmd);
    counter = 0; failAt = n;
    await assert.rejects(applyCommand(releaseCmd), /CORTE/, `debía cortarse en la escritura ${n}`);
    failAt = null;
    await applyCommand(releaseCmd);
    assert.deepEqual(snap(), { a: 10, r: 0, ops: 0, res: ['RELEASED'] }, `corte ${n}`);
    await applyCommand(releaseCmd); // repetido: idempotente
    assert.equal(snap().a, 10, `repetido tras corte ${n}`);
  }
});

test('stock insuficiente: 409 y no queda ninguna reserva a medias', async () => {
  reset(); failAt = null;
  await assert.rejects(applyCommand({ ...reserveCmd, orderId: 'o2', quantity: 99 }), (err) => err.statusCode === 409);
  assert.equal(resv.length, 0);
  assert.equal(snap().a, 10);
});
