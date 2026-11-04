(() => {
const $app = document.getElementById('app'), $who = document.getElementById('who'), $title = document.getElementById('title');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const eur = n => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const dIt = iso => iso ? iso.split('-').reverse().join('/') : '';
const val = id => document.getElementById(id).value;
const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); };
const ss = { get: k => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: k => { try { sessionStorage.removeItem(k); } catch {} } };

class AuthError extends Error {}
async function api(path, { method = 'GET', body, raw } = {}) {
  let r;
  try { r = await fetch('api/admin' + path, { method, headers: { Authorization: 'Bearer ' + ss.get('adm_token'), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Connessione assente'); }
  if (r.status === 401) { ss.del('adm_token'); throw new AuthError('Accesso scaduto: rientra con la password'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Errore ${r.status}`);
  if (raw) return r;
  return r.status === 204 ? null : r.json();
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e instanceof AuthError) return viewLogin(e.message); toast(e.message); } };
const photos = new Map();
const getPhoto = async e => { if (!e.has_photo) return null; if (!photos.has(e.id)) photos.set(e.id, await (await api(`/expenses/${e.id}/photo`, { raw: true })).blob()); return photos.get(e.id); };

function setHeader(title, back) {
  $title.innerHTML = back ? `<button class="link" style="color:#fff;font-size:18px" id="back">← ${esc(title)}</button>` : esc(title);
  if (back) document.getElementById('back').onclick = back;
  $who.innerHTML = !back && ss.get('adm_token') ? '<button id="out">Esci</button>' : '';
  const o = document.getElementById('out'); if (o) o.onclick = () => { ss.del('adm_token'); viewLogin(); };
}

function viewLogin(msg) {
  setHeader('Amministrazione');
  $app.innerHTML = `<div class="login"><h2>Area amministratore</h2>${msg ? `<p style="color:var(--err)">${esc(msg)}</p>` : ''}
    <input id="pw" type="password" autocomplete="current-password" placeholder="Password" style="text-align:center;max-width:280px">
    <div class="actions" style="max-width:280px;margin:16px auto"><button class="btn" id="go">Entra</button></div></div>`;
  const go = async () => {
    const b = document.getElementById('go'); b.disabled = true;
    try {
      const r = await fetch('api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: val('pw') }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Errore ' + r.status);
      ss.set('adm_token', j.token); viewHome('trips');
    } catch (e) { toast(e.message); b.disabled = false; }
  };
  document.getElementById('go').onclick = go; document.getElementById('pw').onkeydown = e => { if (e.key === 'Enter') go(); };
}

const tabs = cur => `<div class="tabs"><button class="chip ${cur === 'trips' ? 'on' : ''}" data-t="trips">Note spese</button><button class="chip ${cur === 'emps' ? 'on' : ''}" data-t="emps">Impiegati</button></div>`;
const bindTabs = () => $app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => viewHome(b.dataset.t));

const viewHome = guard(async tab => {
  setHeader('Amministrazione');
  $app.innerHTML = '<div class="empty">Caricamento…</div>';
  tab === 'emps' ? await viewEmployees() : await viewTrips();
});

let filter = { emp: '', status: '' };
async function viewTrips() {
  const trips = await api('/trips');
  const names = [...new Set(trips.map(t => t.owner.name))].sort();
  const shown = trips.filter(t => (!filter.emp || t.owner.name === filter.emp) && (!filter.status || (filter.status === 'deleted' ? t.deleted : !t.deleted && t.status === filter.status)));
  $app.innerHTML = tabs('trips') + `<div class="grid2"><select id="fe"><option value="">Tutti gli impiegati</option>${names.map(n => `<option ${n === filter.emp ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select id="fs"><option value="">Tutti gli stati</option><option value="closed" ${filter.status === 'closed' ? 'selected' : ''}>Chiuse</option><option value="open" ${filter.status === 'open' ? 'selected' : ''}>In corso</option><option value="deleted" ${filter.status === 'deleted' ? 'selected' : ''}>Eliminate</option></select></div>
    <div style="height:12px"></div>` + (shown.length ? '' : '<div class="empty">Nessuna nota spese.</div>');
  bindTabs();
  document.getElementById('fe').onchange = e => { filter.emp = e.target.value; viewTrips().catch(() => {}); };
  document.getElementById('fs').onchange = e => { filter.status = e.target.value; viewTrips().catch(() => {}); };
  for (const t of shown) {
    const c = document.createElement('div'); c.className = 'card click';
    c.innerHTML = `<div class="row"><span class="big">${esc(t.owner.name)}</span><span class="badge ${t.deleted ? 'off' : t.status === 'closed' ? 'closed' : ''}">${t.deleted ? 'Eliminata' : t.status === 'closed' ? 'Chiusa' : 'In corso'}</span></div>
      <div>${esc(t.destination)} <span class="mut">· ${dIt(t.date_from)} → ${dIt(t.date_to)}${t.client ? ' · ' + esc(t.client) : ''}</span></div>
      <div class="row" style="margin-top:8px"><span class="mut">${t.n_expenses} giustificativi</span><b>${eur(t.total)}</b></div>`;
    c.onclick = () => viewTrip(t.id);
    $app.append(c);
  }
}

const viewTrip = guard(async id => {
  setHeader('Note spese', () => viewHome('trips'));
  $app.innerHTML = '<div class="empty">Caricamento…</div>';
  const t = await api('/trips/' + id);
  const total = t.expenses.reduce((s, e) => s + e.amount, 0);
  $app.innerHTML = `<div class="card"><div class="row"><span class="big">${esc(t.owner.name)}</span><span class="badge ${t.deleted ? 'off' : t.status === 'closed' ? 'closed' : ''}">${t.deleted ? 'Eliminata' : t.status === 'closed' ? 'Chiusa' : 'In corso'}</span></div>
    <div class="mut">${esc(t.owner.department)}</div><div>${esc(t.destination)} · ${dIt(t.date_from)} → ${dIt(t.date_to)}${t.client ? ' · ' + esc(t.client) : ''}</div>
    <div class="row" style="margin-top:8px"><span class="mut">Totale spese</span><b class="big">${eur(total)}</b></div>
    ${t.km != null ? `<div class="mut">Rimborso km: ${t.km} km × ${t.km_rate ?? 0} €</div>` : ''}</div>`;
  for (const e of t.expenses) {
    const c = document.createElement('div'); c.className = 'card exp';
    c.innerHTML = `<img alt="" id="img${e.id}"><div class="grow"><div><b>${esc(e.description || e.category)}</b></div><div class="mut">${dIt(e.date)} · ${esc(e.category)} · ${esc(e.payment)}${e.notes ? ' · ' + esc(e.notes) : ''}</div></div><b>${eur(e.amount)}</b>`;
    $app.append(c);
    getPhoto(e).then(b => { const i = document.getElementById('img' + e.id); if (i && b) { i.src = URL.createObjectURL(b); i.style.cursor = 'pointer'; i.onclick = () => showPhoto(b); } }).catch(() => {});
  }
  $app.insertAdjacentHTML('beforeend', `<div class="actions"><button class="btn" id="xl">⬇ Scarica Excel</button><button class="btn" id="zp">⬇ Scarica foto (ZIP)</button></div>`);
  const run = (bid, fn) => document.getElementById(bid).onclick = guard(async ev => { ev.target.disabled = true; try { await fn(); } finally { ev.target.disabled = false; } });
  run('xl', async () => NS.deliver(await NS.buildExcel(t), `Nota_Spese_${NS.baseName(t)}.xlsx`));
  run('zp', async () => NS.deliver(await NS.buildZip(t, getPhoto), `Scontrini_${NS.baseName(t)}.zip`));
});

function showPhoto(b) {
  const el = document.createElement('div'); el.className = 'sheet'; el.style.background = '#000';
  el.innerHTML = `<div class="inner"><button class="link" style="color:#fff" id="c">← Chiudi</button><img class="preview" style="max-height:none;margin-top:12px" src="${URL.createObjectURL(b)}" alt="Scontrino"></div>`;
  document.body.append(el); el.querySelector('#c').onclick = () => el.remove();
}

async function viewEmployees() {
  const emps = await api('/employees');
  $app.innerHTML = tabs('emps') + `<div class="card"><b>Nuovo impiegato</b>
    <label>Nome e cognome *</label><input id="n_name" autocomplete="off"><label>Reparto</label><input id="n_dep" autocomplete="off">
    <label>Codice personale * (almeno 4 caratteri, lettere o numeri)</label><input id="n_code" autocomplete="off" autocapitalize="off">
    <div class="actions"><button class="btn" id="n_add">Aggiungi</button></div></div>`;
  bindTabs();
  document.getElementById('n_add').onclick = guard(async () => {
    await api('/employees', { method: 'POST', body: { name: val('n_name'), department: val('n_dep'), code: val('n_code') } }); viewHome('emps');
  });
  for (const e of emps) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="row"><span class="big">${esc(e.name)}</span><span class="badge ${e.active ? 'closed' : 'off'}">${e.active ? 'Attivo' : 'Disattivato'}</span></div>
      <div class="mut">${esc(e.department) || 'Reparto non indicato'} · ${e.n_trips} note spese</div>
      <div style="margin-top:6px">Codice: <span class="code">${esc(e.code)}</span></div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap;justify-content:flex-start"><button class="btn sec mini" data-a="code">Cambia codice</button><button class="btn sec mini" data-a="dep">Reparto</button><button class="btn ${e.active ? 'danger' : 'sec'} mini" data-a="act">${e.active ? 'Disattiva' : 'Riattiva'}</button></div>`;
    c.querySelector('[data-a=code]').onclick = guard(async () => { const v = prompt(`Nuovo codice per ${e.name}`, e.code); if (v != null) { await api('/employees/' + e.id, { method: 'PATCH', body: { code: v.trim() } }); viewHome('emps'); } });
    c.querySelector('[data-a=dep]').onclick = guard(async () => { const v = prompt(`Reparto di ${e.name}`, e.department); if (v != null) { await api('/employees/' + e.id, { method: 'PATCH', body: { department: v.trim() } }); viewHome('emps'); } });
    c.querySelector('[data-a=act]').onclick = guard(async () => { if (e.active && !confirm(`Disattivare ${e.name}? Non potrà più entrare; le sue note spese restano.`)) return; await api('/employees/' + e.id, { method: 'PATCH', body: { active: !e.active } }); viewHome('emps'); });
    $app.append(c);
  }
}

ss.get('adm_token') ? viewHome('trips') : viewLogin();
})();
