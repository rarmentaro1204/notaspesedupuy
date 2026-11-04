import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.TEST_PGLITE = '1';
process.env.SESSION_SECRET = 'segreto-di-prova-0123456789';
process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.SEED_EMPLOYEES = 'Roberto Armentaro:1204:Direzione,Stefano Zaccaria:1403,Alex Barraco:1234';
const { app } = await import('../api/index.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(() => server.close());

const call = async (method, p, { token, body, ip = '1.1.1.1' } = {}) => {
  const r = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const login = async code => (await call('POST', '/login', { body: { code }, ip: '9.9.9.9' })).body.token;
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const trip = { destination: 'Monaco', client: 'Fiera', date_from: '2026-11-02', date_to: '2026-11-04' };
const exp = { date: '2026-11-03', category: 'Pasti', payment: 'Contanti', amount: '42,50', description: 'Pranzo', photo: PHOTO };

test('senza token o con token falso: 401', async () => {
  assert.equal((await call('GET', '/trips')).status, 401);
  assert.equal((await call('GET', '/trips', { token: 'abc.def' })).status, 401);
  assert.equal((await call('GET', '/admin/trips')).status, 401);
});

test('codici: giusto entra (con il nome), sbagliato no', async () => {
  const ok = await call('POST', '/login', { body: { code: '1204' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.name, 'Roberto Armentaro'); assert.equal(ok.body.department, 'Direzione');
  assert.equal((await call('POST', '/login', { body: { code: '0000' }, ip: '2.2.2.2' })).status, 401);
  assert.equal((await call('POST', '/login', { body: { code: '' }, ip: '2.2.2.2' })).status, 401);
});

test('blocco dopo troppi tentativi sbagliati (stesso IP), anche col codice giusto', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/login', { body: { code: '77' + i }, ip: '3.3.3.3' })).status, 401);
  assert.equal((await call('POST', '/login', { body: { code: '1204' }, ip: '3.3.3.3' })).status, 429);
  assert.equal((await call('POST', '/login', { body: { code: '1204' }, ip: '4.4.4.4' })).status, 200); // altro IP non toccato
});

test('flusso impiegato: trasferta → spesa con foto → chiusura', async () => {
  const t = await login('1204');
  let r = await call('POST', '/trips', { token: t, body: trip }); assert.equal(r.status, 201);
  const id = r.body.id; assert.equal(r.body.owner.name, 'Roberto Armentaro');
  assert.equal((await call('POST', `/trips/${id}/expenses`, { token: t, body: { ...exp, category: '' } })).status, 400);
  assert.equal((await call('POST', `/trips/${id}/expenses`, { token: t, body: { ...exp, photo: 'x' } })).status, 400);
  r = await call('POST', `/trips/${id}/expenses`, { token: t, body: exp }); assert.equal(r.status, 201); assert.equal(r.body.amount, 42.5);
  const eid = r.body.id;
  r = await call('GET', `/expenses/${eid}/photo`, { token: t }); assert.equal(r.status, 200); assert.equal(r.body.subarray(0, 2).toString('hex'), 'ffd8'); // JPEG intatto
  r = await call('GET', `/trips/${id}`, { token: t }); assert.equal(r.body.expenses.length, 1); assert.equal(r.body.total, 42.5);
  r = await call('POST', `/trips/${id}/close`, { token: t }); assert.equal(r.body.status, 'closed');
  assert.equal((await call('POST', `/trips/${id}/expenses`, { token: t, body: exp })).status, 400); // chiusa
  assert.equal((await call('DELETE', `/expenses/${eid}`, { token: t })).status, 400);
  assert.equal((await call('POST', `/trips/${id}/reopen`, { token: t })).status, 200);
  assert.equal((await call('DELETE', `/expenses/${eid}`, { token: t })).status, 204);
});

test('ogni impiegato vede SOLO le proprie note spese (e foto)', async () => {
  const a = await login('1204'), b = await login('1403');
  const t = (await call('POST', '/trips', { token: a, body: trip })).body;
  const e = (await call('POST', `/trips/${t.id}/expenses`, { token: a, body: exp })).body;
  assert.equal((await call('GET', `/trips/${t.id}`, { token: b })).status, 404);
  assert.equal((await call('GET', `/expenses/${e.id}/photo`, { token: b })).status, 404);
  assert.equal((await call('POST', `/trips/${t.id}/expenses`, { token: b, body: exp })).status, 404);
  assert.equal((await call('DELETE', `/trips/${t.id}`, { token: b })).status, 404);
  assert.ok(!(await call('GET', '/trips', { token: b })).body.some(x => x.id === t.id));
  assert.equal((await call('GET', '/admin/trips', { token: b })).status, 401); // il token impiegato non vale per l'admin
});

test('limite 15 righe', async () => {
  const t = await login('1234'); const id = (await call('POST', '/trips', { token: t, body: trip })).body.id;
  for (let i = 0; i < 15; i++) assert.equal((await call('POST', `/trips/${id}/expenses`, { token: t, body: exp })).status, 201);
  assert.equal((await call('POST', `/trips/${id}/expenses`, { token: t, body: exp })).status, 400);
});

test('amministratore: password, vede tutto, gestisce gli impiegati', async () => {
  assert.equal((await call('POST', '/admin/login', { body: { password: 'no' }, ip: '5.5.5.5' })).status, 401);
  const { body } = await call('POST', '/admin/login', { body: { password: 'admin-pw' } });
  const adm = body.token; assert.ok(adm);
  const trips = (await call('GET', '/admin/trips', { token: adm })).body;
  assert.ok(new Set(trips.map(t => t.owner.name)).size >= 2); // Roberto e Alex hanno già trasferte
  const one = trips.find(t => t.n_expenses > 0);
  const d = (await call('GET', `/admin/trips/${one.id}`, { token: adm })).body; assert.ok(d.expenses.length);
  assert.equal((await call('GET', `/admin/expenses/${d.expenses[0].id}/photo`, { token: adm })).status, 200);

  let r = await call('POST', '/admin/employees', { token: adm, body: { name: 'Nuovo Utente', code: '9876', department: 'Tecnico' } }); assert.equal(r.status, 201);
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Doppio', code: '9876' } })).status, 400); // codice già usato
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Corto', code: '12' } })).status, 400);
  const tokNew = await login('9876'); assert.ok(tokNew);
  await call('PATCH', `/admin/employees/${r.body.id}`, { token: adm, body: { active: false } });
  assert.equal((await call('GET', '/trips', { token: tokNew })).status, 401);            // disattivato: il token già emesso non vale più
  assert.equal((await call('POST', '/login', { body: { code: '9876' }, ip: '8.8.8.8' })).status, 401);
});

test('eliminazione impiegato = soft: l\'admin conserva la traccia', async () => {
  const a = await login('1403'); const t = (await call('POST', '/trips', { token: a, body: trip })).body;
  assert.equal((await call('DELETE', `/trips/${t.id}`, { token: a })).status, 204);
  assert.equal((await call('GET', `/trips/${t.id}`, { token: a })).status, 404);
  const adm = (await call('POST', '/admin/login', { body: { password: 'admin-pw' }, ip: '6.6.6.6' })).body.token;
  assert.equal((await call('GET', `/admin/trips/${t.id}`, { token: adm })).body.deleted, true);
});
