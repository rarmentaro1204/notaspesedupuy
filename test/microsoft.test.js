// Login Microsoft: token firmati con una chiave di prova; le chiavi pubbliche di Microsoft sono simulate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TEST_PGLITE = '1'; process.env.SESSION_SECRET = 'segreto-di-prova-0123456789'; process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.SEED_EMPLOYEES = 'Roberto Armentaro:1204:Direzione:roberto@azienda.it,Stefano Zaccaria:1403,Alex Barraco:1234:Commerciale:Alex.Barraco@Azienda.it';
const TENANT = '11111111-2222-3333-4444-555555555555', CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const { app } = await import('../api/index.js');

const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
const realFetch = globalThis.fetch;
let jwksCalls = 0;
globalThis.fetch = async (url, init) => String(url).includes('login.microsoftonline.com')
  ? (jwksCalls++, Response.json({ keys: [jwk] })) : realFetch(url, init);

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function token(claims = {}, { key = kp.privateKey, header = { alg: 'RS256', kid: 'k1' } } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: CLIENT, exp: now + 3600, nbf: now - 10, nonce: 'N1', preferred_username: 'roberto@azienda.it', ...claims };
  const signing = b64(header) + '.' + b64(body);
  return signing + '.' + (header.alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(signing), key).toString('base64url'));
}

let server, base;
before(() => new Promise(r => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(() => { server.close(); globalThis.fetch = realFetch; });
const call = async (method, p, { token: t, body, ip = '1.1.1.1' } = {}) => {
  const r = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const ms = (idt, extra = {}) => call('POST', '/login/microsoft', { body: { id_token: idt, nonce: 'N1' }, ...extra });

test('non configurato: nessun pulsante Microsoft e login disattivato', async () => {
  delete process.env.AZURE_CLIENT_ID; delete process.env.AZURE_TENANT_ID;
  assert.equal((await call('GET', '/config')).body.microsoft, null);
  assert.equal((await ms(token())).status, 503);
});

test('configurato: /api/config espone solo i valori pubblici', async () => {
  process.env.AZURE_CLIENT_ID = CLIENT; process.env.AZURE_TENANT_ID = TENANT;
  assert.deepEqual((await call('GET', '/config')).body, { microsoft: { clientId: CLIENT, tenantId: TENANT } });
});

test('token valido + e-mail registrata → entra e la sessione funziona', async () => {
  const r = await ms(token()); assert.equal(r.status, 200); assert.equal(r.body.name, 'Roberto Armentaro');
  const me = await call('GET', '/me', { token: r.body.token }); assert.equal(me.status, 200); assert.equal(me.body.name, 'Roberto Armentaro');
});

test('e-mail confrontata senza distinguere maiuscole; accetta anche claim "email"', async () => {
  const r = await ms(token({ preferred_username: undefined, email: 'ALEX.barraco@azienda.IT' })); assert.equal(r.status, 200); assert.equal(r.body.name, 'Alex Barraco');
});

test('account Microsoft valido ma non registrato → 403 con messaggio chiaro', async () => {
  const r = await ms(token({ preferred_username: 'sconosciuto@azienda.it' })); assert.equal(r.status, 403); assert.match(r.body.error, /sconosciuto@azienda\.it/);
});

test('impiegato disattivato → 403', async () => {
  const adm = (await call('POST', '/admin/login', { body: { password: 'admin-pw' } })).body.token;
  const list = (await call('GET', '/admin/employees', { token: adm })).body; const e = list.find(x => x.email === 'roberto@azienda.it');
  await call('PATCH', `/admin/employees/${e.id}`, { token: adm, body: { active: false } });
  assert.equal((await ms(token())).status, 403);
  await call('PATCH', `/admin/employees/${e.id}`, { token: adm, body: { active: true } });
  assert.equal((await ms(token())).status, 200);
});

test('token non valido → 401 (firma, emittente, destinatario, scadenza, nonce, algoritmo)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = token(), [h, p, sig] = good.split('.');
  const cases = {
    'firma di un\'altra chiave': token({}, { key: other.privateKey }),
    'payload alterato': h + '.' + b64({ ...JSON.parse(Buffer.from(p, 'base64url')), preferred_username: 'alex.barraco@azienda.it' }) + '.' + sig,
    'emittente di un altro tenant': token({ iss: 'https://login.microsoftonline.com/99999999-0000-0000-0000-000000000000/v2.0' }),
    'tenant diverso': token({ tid: '99999999-0000-0000-0000-000000000000' }),
    'destinatario diverso (token di un\'altra app)': token({ aud: 'altra-app' }),
    'scaduto': token({ exp: now - 5 }),
    'nonce diverso (token rubato/riusato)': token({ nonce: 'ALTRO' }),
    'algoritmo none': token({}, { header: { alg: 'none', kid: 'k1' } }),
    'kid sconosciuto': token({}, { header: { alg: 'RS256', kid: 'zzz' } }),
    'malformato': 'abc.def', 'vuoto': '',
  };
  let n = 0;   // un IP diverso per caso: altrimenti scatta (giustamente) il blocco dopo 8 tentativi
  for (const [nome, t] of Object.entries(cases)) assert.equal((await ms(t, { ip: `10.0.0.${++n}` })).status, 401, nome);
});

test('troppi token falsi dallo stesso IP → 429, altri IP non toccati', async () => {
  for (let i = 0; i < 8; i++) await ms('x.y.z', { ip: '3.3.3.3' });
  assert.equal((await ms(token(), { ip: '3.3.3.3' })).status, 429);
  assert.equal((await ms(token(), { ip: '4.4.4.4' })).status, 200);
});

test('tenant non GUID (es. "common"): rifiutato con messaggio di configurazione', async () => {
  process.env.AZURE_TENANT_ID = 'common';
  const r = await ms(token(), { ip: '5.5.5.5' }); assert.equal(r.status, 500); assert.match(r.body.error, /AZURE_TENANT_ID/);
  process.env.AZURE_TENANT_ID = TENANT;
});

test('amministratore: e-mail assegnabile, validata e univoca', async () => {
  const adm = (await call('POST', '/admin/login', { body: { password: 'admin-pw' }, ip: '6.6.6.6' })).body.token;
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Nuovo', code: '7777', email: 'nuovo@azienda.it' } })).body.email, 'nuovo@azienda.it');
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Doppio', code: '7778', email: 'NUOVO@azienda.it' } })).status, 400);   // e-mail già usata
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Male', code: '7779', email: 'non-una-email' } })).status, 400);
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Senza', code: '7780' } })).status, 201);                                    // e-mail facoltativa
  assert.equal((await call('POST', '/admin/employees', { token: adm, body: { name: 'Senza2', code: '7781' } })).status, 201);                                   // più impiegati senza e-mail ok
});
