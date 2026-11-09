// Test nel browser reale (serve playwright): app impiegati + pagina amministratore, con Postgres in memoria.
// Uso: node test/e2e.cjs [cartella-output]
process.env.TEST_PGLITE = '1'; process.env.SESSION_SECRET = 'segreto-di-prova-0123456789'; process.env.ADMIN_PASSWORD = 'admin-pw';
process.env.SEED_EMPLOYEES = 'Roberto Armentaro:1204:Direzione,Stefano Zaccaria:1403,Alex Barraco:1234';
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const assert = require('assert/strict');
const PUB = path.join(__dirname, '../public'); const OUT = process.argv[2] || '/tmp';

(async () => {
  const express = (await import('express')).default; const { app } = await import('../api/index.js');
  const outer = express(); outer.use(express.static(PUB)); outer.use(app); const srv = outer.listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, acceptDownloads: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const toastText = async () => { await p.waitForSelector('#toast.show'); return p.textContent('#toast'); };

  // --- impiegato: codice sbagliato, poi giusto ---
  await p.goto(base + '/'); await p.waitForSelector('#code');
  await p.fill('#code', '9999'); await p.click('#go'); assert.match(await toastText(), /Codice non valido/);
  await p.fill('#code', '1204'); await p.click('#go'); await p.waitForSelector('.fab'); assert.match(await p.textContent('#who'), /Roberto Armentaro/);
  await p.click('.fab'); await p.fill('#f_dest', 'Monaco di Baviera'); await p.fill('#f_client', 'Productronica');
  await p.fill('#f_from', '2026-11-02'); await p.fill('#f_to', '2026-11-04'); await p.click('#save'); await p.waitForSelector('.fab');
  const add = async (cat, date, amt, pay, desc) => {
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.fab')]);
    await fc.setFiles({ name: 'r.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(PUB, 'icon-512.png')) });
    await p.waitForSelector('#ok'); assert.equal(await p.isDisabled('#ok'), true);
    await p.click(`[data-c="${cat}"]`); await p.fill('#r_date', date); await p.fill('#r_amt', amt); await p.click(`[data-p="${pay}"]`); await p.fill('#r_desc', desc);
    await p.click('#ok'); await p.waitForSelector('.sheet', { state: 'detached' });
  };
  await add('Pasti', '2026-11-03', '42,50', 'Carta Aziendale', 'Pranzo con cliente'); await add('Taxi', '2026-11-04', '30', 'Contanti', 'Taxi aeroporto');
  await p.waitForFunction(() => document.querySelectorAll('.exp').length === 2); assert.match(await p.textContent('.card'), /72,50/);
  // spesa SENZA foto (es. hotel prenotato online): serve il motivo
  await p.click('#nophoto'); await p.waitForSelector('[data-r]'); await p.click('[data-c="Hotel"]'); await p.fill('#r_date', '2026-11-03'); await p.fill('#r_amt', '120'); await p.click('[data-p="Carta Aziendale"]');
  assert.equal(await p.isDisabled('#ok'), true, 'senza motivo non si salva'); await p.click('[data-r="Fattura"]'); await p.fill('#r_desc', 'Hotel Monaco 1 notte');
  await p.click('#ok'); await p.waitForSelector('.sheet', { state: 'detached' });
  await p.waitForFunction(() => document.querySelectorAll('.exp').length === 3); assert.match(await p.textContent('.noimg'), /Senza foto/); assert.match(await p.textContent('#explist'), /Fattura/);
  await p.waitForFunction(() => [...document.querySelectorAll('.exp img')].every(i => i.src.startsWith('blob:')));   // le foto tornano dal server
  await p.reload(); await p.waitForSelector('.card.click');                                                       // accesso e dati restano
  await p.click('.card.click'); await p.waitForSelector('#close'); await p.fill('#km_rate', '0,42'); await p.fill('#km', '120');
  await p.click('#close'); await p.waitForSelector('#xl');
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); await dl.saveAs(OUT + '/emp.xlsx');
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('#zp')]); await dl.saveAs(OUT + '/emp.zip');

  // --- un altro impiegato non vede nulla ---
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('#code');
  await p.fill('#code', '1403'); await p.click('#go'); await p.waitForSelector('.fab'); assert.match(await p.textContent('#app'), /Nessuna nota spese/);

  // --- amministratore ---
  await p.goto(base + '/admin.html'); await p.waitForSelector('#pw');
  await p.fill('#pw', 'sbagliata'); await p.click('#go'); assert.match(await toastText(), /Password errata/);
  await p.fill('#pw', 'admin-pw'); await p.click('#go'); await p.waitForSelector('.card.click');
  assert.match(await p.textContent('.card.click'), /Roberto Armentaro/); assert.match(await p.textContent('.card.click'), /192,50/);
  await p.click('.card.click'); await p.waitForSelector('#xl'); await p.waitForFunction(() => [...document.querySelectorAll('.exp img')].every(i => i.src.startsWith('blob:')));
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('#xl')]); await dl.saveAs(OUT + '/adm.xlsx');
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('#zp')]); await dl.saveAs(OUT + '/adm.zip');
  await p.click('#back'); await p.click('[data-t="emps"]'); await p.waitForSelector('#n_add');
  assert.match(await p.textContent('#app'), /1403/);
  await p.fill('#n_name', 'Prova Nuova'); await p.fill('#n_code', '5555'); await p.click('#n_add'); await p.waitForFunction(() => document.body.textContent.includes('Prova Nuova'));
  await p.screenshot({ path: OUT + '/admin.png' });
  assert.deepEqual(errs, []); console.log('E2E OK'); await b.close(); srv.close(); process.exit(0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
