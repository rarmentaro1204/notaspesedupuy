// Login Microsoft nel browser reale, con Microsoft simulato (autorizzazione, token endpoint, chiavi pubbliche).
// Verifica anche il PKCE: il "code_verifier" inviato al token endpoint deve corrispondere al "code_challenge" dell'autorizzazione.
// Uso: node test/e2e-microsoft.cjs   (serve playwright)
process.env.TEST_PGLITE = '1'; process.env.SESSION_SECRET = 'segreto-di-prova-0123456789'; process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.SEED_EMPLOYEES = 'Roberto Armentaro:1204:Direzione:roberto@azienda.it,Stefano Zaccaria:1403';
const TENANT = '11111111-2222-3333-4444-555555555555', CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
process.env.AZURE_CLIENT_ID = CLIENT; process.env.AZURE_TENANT_ID = TENANT;
const { chromium } = require('playwright'); const crypto = require('crypto'); const path = require('path'); const assert = require('assert/strict');
const PUB = path.join(__dirname, '../public');

(async () => {
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes('login.microsoftonline.com') ? Response.json({ keys: [jwk] }) : realFetch(u, i);   // chiavi pubbliche simulate (lato server)
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (email, nonce) => { const now = Math.floor(Date.now() / 1000);
    const s = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: CLIENT, exp: now + 3600, nbf: now - 5, nonce, preferred_username: email });
    return s + '.' + crypto.sign('RSA-SHA256', Buffer.from(s), kp.privateKey).toString('base64url'); };

  const express = (await import('express')).default; const { app } = await import('../api/index.js');
  const outer = express(); outer.use(express.static(PUB)); outer.use(app); const srv = outer.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));

  // scenario corrente del "Microsoft simulato"
  let scenario = { email: 'roberto@azienda.it' }, last = {};
  await p.route(/login\.microsoftonline\.com\/.*\/oauth2\/v2\.0\/authorize/, route => {
    const q = new URL(route.request().url()).searchParams;
    assert.equal(q.get('client_id'), CLIENT); assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('redirect_uri'), base + '/'); assert.match(q.get('scope'), /openid/); assert.ok(q.get('state') && q.get('nonce') && q.get('code_challenge'));
    assert.ok(route.request().url().includes(`/${TENANT}/`));
    last = { challenge: q.get('code_challenge'), nonce: q.get('nonce'), state: q.get('state') };
    const back = new URL(q.get('redirect_uri'));
    if (scenario.denied) back.searchParams.set('error', 'access_denied'), back.searchParams.set('error_description', 'AADSTS65004: Accesso annullato dall\'utente');
    else back.searchParams.set('code', 'CODE123');
    back.searchParams.set('state', scenario.wrongState ? 'stato-falso' : q.get('state'));
    route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await p.route(/login\.microsoftonline\.com\/.*\/oauth2\/v2\.0\/token/, route => {
    if (scenario.tokenError) return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: 'invalid_request', error_description: 'AADSTS9002326: Cross-origin token redemption is permitted only for the \'Single-Page Application\' client-type.\r\nTrace ID: x' }) });
    const f = new URLSearchParams(route.request().postData());
    assert.equal(f.get('grant_type'), 'authorization_code'); assert.equal(f.get('code'), 'CODE123'); assert.equal(f.get('client_id'), CLIENT); assert.equal(f.get('redirect_uri'), base + '/');
    assert.equal(crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url'), last.challenge, 'PKCE: il verifier deve corrispondere al challenge');
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id_token: idToken(scenario.email, last.nonce), token_type: 'Bearer' }) });
  });
  const start = async () => { await p.goto(base + '/'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload(); await p.waitForSelector('#msgo'); };

  // 1) accesso riuscito
  await start(); assert.match(await p.textContent('.login'), /oppure/);
  await p.click('#msgo'); await p.waitForSelector('.card.click, .empty, .hello');
  assert.match(await p.textContent('#who'), /Roberto Armentaro/); assert.equal(p.url(), base + '/', "l'indirizzo non deve conservare code/state");
  await p.reload(); await p.waitForSelector('.hello'); assert.match(await p.textContent('.hello'), /Roberto/);               // la sessione resta dopo il riavvio
  // 2) account Microsoft non registrato → messaggio e il codice resta utilizzabile
  scenario = { email: 'estraneo@altra.it' }; await start(); await p.click('#msgo'); await p.waitForSelector('[role=alert]');
  assert.match(await p.textContent('[role=alert]'), /estraneo@altra\.it.*non è abilitato/); assert.equal(p.url(), base + '/');
  await p.fill('#code', '1403'); await p.click('#go'); await p.waitForSelector('.hello'); assert.match(await p.textContent('#who'), /Stefano/);
  // 3) l'utente annulla da Microsoft
  scenario = { denied: true }; await start(); await p.click('#msgo'); await p.waitForSelector('[role=alert]'); assert.match(await p.textContent('[role=alert]'), /annullato/);
  // 4) "state" diverso (possibile attacco CSRF) → rifiutato senza contattare il token endpoint
  scenario = { wrongState: true, email: 'roberto@azienda.it' }; await start(); await p.click('#msgo'); await p.waitForSelector('[role=alert]'); assert.match(await p.textContent('[role=alert]'), /interrotto/);
  assert.ok(!(await p.evaluate(() => localStorage.getItem('ns_token'))), 'nessuna sessione creata');
  // 5) app registrata nel tipo sbagliato → messaggio utile per chi configura
  scenario = { tokenError: true }; await start(); await p.click('#msgo'); await p.waitForSelector('[role=alert]'); assert.match(await p.textContent('[role=alert]'), /Single-page application/);
  // 6) Microsoft non configurato → nessun pulsante
  process.env.AZURE_CLIENT_ID = ''; await p.goto(base + '/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('#code');
  await p.waitForTimeout(300); assert.equal(await p.locator('#msgo').count(), 0);
  assert.deepEqual(errs, []); console.log('E2E MICROSOFT OK'); await br.close(); srv.close(); globalThis.fetch = realFetch; process.exit(0);
})().catch(e => { console.error('E2E MICROSOFT FAIL', e); process.exit(1); });
