(() => {
const CATEGORIES = ['Trasporti', 'Carburante', 'Pedaggi', 'Taxi', 'Parcheggio', 'Hotel', 'Pasti', 'Altro'];
const PAYMENTS = ['Carta Aziendale', 'Carta Personale', 'Contanti', 'Bonifico'];
const MAX_ROWS = 15;   // righe del modulo (14-28)
const REASONS = ['Fattura', 'Pagamento senza scontrino'];   // giustificativo quando non c'è la foto

const $app = document.getElementById('app'), $who = document.getElementById('who'), $title = document.getElementById('title');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const eur = n => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const dIt = iso => iso ? iso.split('-').reverse().join('/') : '';
const val = id => document.getElementById(id).value;
const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); };
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

// ================= comunicazione col server =================
class AuthError extends Error {}
async function api(path, { method = 'GET', body, raw } = {}) {
  let r;
  try {
    r = await fetch('api' + path, { method, headers: { Authorization: 'Bearer ' + ls.get('ns_token'), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Connessione assente: riprova quando hai rete'); }
  if (r.status === 401) { ls.del('ns_token'); throw new AuthError((await r.json().catch(() => ({}))).error || 'Accesso scaduto'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Errore ${r.status}`);
  if (raw) return r;
  return r.status === 204 ? null : r.json();
}
const photos = new Map();
const getPhoto = async e => {
  if (!e.has_photo) return null;
  if (!photos.has(e.id)) photos.set(e.id, await (await api(`/expenses/${e.id}/photo`, { raw: true })).blob());
  return photos.get(e.id);
};
// ogni schermata passa da qui: se l'accesso è scaduto si torna al codice
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e instanceof AuthError) return viewLogin(e.message); throw e; } };

// ================= viste =================
function setHeader(title, back) {
  $title.innerHTML = back ? `<button class="link" style="color:#fff;font-size:18px" id="back">← ${esc(title)}</button>` : esc(title);
  if (back) document.getElementById('back').onclick = back;
  $who.innerHTML = ls.get('ns_name') && !back ? `<span class="who-name">${esc(ls.get('ns_name'))}</span><button id="out">Esci</button>` : '';
  const o = document.getElementById('out'); if (o) o.onclick = () => { if (confirm('Uscire? Le note spese restano salvate: per rientrare serve il tuo codice.')) { ls.del('ns_token'); viewLogin(); } };
}
// Barra azioni in basso: pulsante principale + (facoltativo) pulsante secondario
const fab = (label, fn, extra) => {
  const bar = document.createElement('div'); bar.className = 'fabbar';
  const b = document.createElement('button'); b.className = 'btn fab'; b.textContent = label; b.onclick = fn; bar.append(b);
  if (extra) { const x = document.createElement('button'); x.className = 'btn sec fabsec'; x.id = extra.id; x.textContent = extra.label; x.onclick = extra.fn; bar.append(x); }
  $app.append(bar);
};
const thumb = e => e.has_photo ? `<img alt="Scontrino" id="img${e.id}">` : '<div class="noimg">Senza foto</div>';
const reasonBadge = e => e.has_photo ? '' : `<br><span class="badge warn">${esc(e.reason || 'Senza foto')}</span>`;
const total = t => t.expenses.reduce((s, e) => s + e.amount, 0);

function viewLogin(msg) {
  setHeader('Nota Spese');
  $app.innerHTML = `<div class="login"><img class="logo" src="icon-192.png" alt=""><h2>Note spese di trasferta</h2><p class="mut">Inserisci il tuo codice personale.</p>
    ${msg ? `<p style="color:var(--err)">${esc(msg)}</p>` : ''}
    <input id="code" type="password" autocomplete="off" autocapitalize="off" inputmode="text" placeholder="Codice">
    <div class="actions" style="margin-top:14px"><button class="btn" id="go">Entra</button></div></div>`;
  const go = async () => {
    const b = document.getElementById('go'); b.disabled = true;
    try {
      const r = await (await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: val('code').trim() }) }).catch(() => { throw new Error('Connessione assente'); }));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Errore ' + r.status);
      ls.set('ns_token', j.token); ls.set('ns_name', j.name); viewDashboard();
    } catch (e) { toast(e.message); b.disabled = false; }
  };
  document.getElementById('go').onclick = go;
  document.getElementById('code').onkeydown = e => { if (e.key === 'Enter') go(); };
}

const viewDashboard = guard(async () => {
  setHeader('Le mie note spese');
  $app.innerHTML = '<div class="empty">Caricamento…</div>';
  let trips;
  try { trips = await api('/trips'); } catch (e) { if (e instanceof AuthError) throw e; $app.innerHTML = `<div class="empty">${esc(e.message)}<br><button class="link" id="retry">Riprova</button></div>`; document.getElementById('retry').onclick = viewDashboard; return; }
  const hello = `<div class="hello">Ciao, ${esc(ls.get('ns_name'))}</div>`;
  $app.innerHTML = hello + (trips.length ? '<div class="cards" id="trips"></div>' : '<div class="empty">Nessuna nota spese.<br>Creane una con il pulsante qui sotto.</div>');
  for (const t of trips) {
    const c = document.createElement('div'); c.className = 'card click';
    c.innerHTML = `<div class="row"><span class="big">${esc(t.destination)}</span><span class="badge ${t.status === 'closed' ? 'closed' : ''}">${t.status === 'closed' ? 'Chiusa' : 'In corso'}</span></div>
      <div class="mut">${dIt(t.date_from)} → ${dIt(t.date_to)}${t.client ? ' · ' + esc(t.client) : ''}</div>
      <div class="row" style="margin-top:10px"><span class="mut">${t.n_expenses} giustificativi</span><span class="money">${eur(t.total)}</span></div>`;
    c.onclick = () => viewTrip(t.id);
    document.getElementById('trips').append(c);
  }
  fab('+ Nuova nota spese', viewNewTrip);
});

function tripForm(t = {}) {
  return `<label>Luogo della trasferta *</label><input id="f_dest" value="${esc(t.destination)}" placeholder="es. Monaco di Baviera" autocomplete="off">
    <label>Cliente / Evento</label><input id="f_client" value="${esc(t.client)}" placeholder="es. Fiera Productronica" autocomplete="off">
    <div class="grid2"><div><label>Dal *</label><input id="f_from" type="date" value="${esc(t.date_from)}"></div><div><label>Al *</label><input id="f_to" type="date" value="${esc(t.date_to)}"></div></div>`;
}
const readTripForm = () => ({ destination: val('f_dest'), client: val('f_client'), date_from: val('f_from'), date_to: val('f_to') });

function viewNewTrip() {
  setHeader('Nuova nota spese', viewDashboard);
  $app.innerHTML = `<div class="card narrow">${tripForm({ date_from: today(), date_to: today() })}<div class="actions" style="margin-top:16px"><button class="btn" id="save">Crea nota spese</button></div></div>`;
  document.getElementById('save').onclick = guard(async ev => {
    ev.target.disabled = true;
    try { const t = await api('/trips', { method: 'POST', body: readTripForm() }); viewTrip(t.id); }
    catch (e) { if (e instanceof AuthError) throw e; toast(e.message); ev.target.disabled = false; }
  });
}

const viewTrip = guard(async id => {
  setHeader('Trasferta', viewDashboard);
  $app.innerHTML = '<div class="empty">Caricamento…</div>';
  let t;
  try { t = await api('/trips/' + id); } catch (e) { if (e instanceof AuthError) throw e; toast(e.message); return viewDashboard(); }
  const open = t.status === 'open';
  $app.innerHTML = `<div class="split">
    <div class="card summary"><div class="row"><span class="big">${esc(t.destination)}</span><span class="badge ${open ? '' : 'closed'}">${open ? 'In corso' : 'Chiusa'}</span></div>
      <div class="mut">${dIt(t.date_from)} → ${dIt(t.date_to)}${t.client ? ' · ' + esc(t.client) : ''}</div>
      <div class="row" style="margin-top:12px"><span class="mut">Totale spese · ${t.expenses.length}/${MAX_ROWS} righe</span><span class="money big">${eur(total(t))}</span></div>
      ${open ? '<button class="link" id="edit">Modifica dati trasferta</button>' : ''}</div>
    <div class="list" id="explist"></div><div class="tools" id="tools"></div></div>`;
  const list = document.getElementById('explist'), tools = document.getElementById('tools');
  if (!t.expenses.length) list.innerHTML = '<div class="empty">Nessun giustificativo.<br>Fotografa il primo scontrino.</div>';
  for (const e of t.expenses) {
    const c = document.createElement('div'); c.className = 'card exp';
    c.innerHTML = `${thumb(e)}<div><div class="t">${esc(e.description || e.category)}</div>
      <div class="mut">${dIt(e.date)} · ${esc(e.category)} · ${esc(e.payment)}${e.notes ? '<br>' + esc(e.notes) : ''}${reasonBadge(e)}</div></div>
      <div class="amt"><span class="money">${eur(e.amount)}</span>${open ? `<button class="link del" data-del="${e.id}">Elimina</button>` : ''}</div>`;
    list.append(c);
    getPhoto(e).then(b => { const i = document.getElementById('img' + e.id); if (i && b) { i.src = URL.createObjectURL(b); i.onclick = () => showPhoto(b); } }).catch(() => {});
  }
  $app.querySelectorAll('[data-del]').forEach(b => b.onclick = guard(async () => {
    if (!confirm('Eliminare questa spesa e la sua foto?')) return;
    try { await api('/expenses/' + b.dataset.del, { method: 'DELETE' }); viewTrip(id); } catch (e) { if (e instanceof AuthError) throw e; toast(e.message); }
  }));
  if (open) {
    document.getElementById('edit').onclick = () => editTrip(t);
    tools.innerHTML = `<div class="card"><b>Rimborso chilometrico</b> <span class="mut">(facoltativo)</span>
      <div class="grid2" style="margin-top:10px"><div><label>Tariffa €/Km</label><input id="km_rate" inputmode="decimal" value="${t.km_rate ?? ''}"></div>
      <div><label>Km percorsi</label><input id="km" inputmode="decimal" value="${t.km ?? ''}"></div></div></div>
      <div class="actions"><button class="btn sec" id="close" ${t.expenses.length ? '' : 'disabled'}>Chiudi trasferta e genera Excel</button><button class="btn danger" id="del">Elimina nota spese</button></div>`;
    document.getElementById('close').onclick = guard(async ev => {
      const kr = num(val('km_rate')), km = num(val('km'));
      if ([kr, km].some(v => v != null && !(v >= 0))) return toast('Km o tariffa non validi');
      ev.target.disabled = true;
      try { await api('/trips/' + id, { method: 'PATCH', body: { km_rate: kr, km } }); await api(`/trips/${id}/close`, { method: 'POST' }); viewTrip(id); }
      catch (e) { if (e instanceof AuthError) throw e; toast(e.message); ev.target.disabled = false; }
    });
    document.getElementById('del').onclick = guard(async () => {
      if (!confirm("Eliminare l'intera nota spese?")) return;
      try { await api('/trips/' + id, { method: 'DELETE' }); viewDashboard(); } catch (e) { if (e instanceof AuthError) throw e; toast(e.message); }
    });
    fab('+  Aggiungi giustificativo', () => addReceipt(t), { id: 'nophoto', label: 'Senza foto', fn: () => addReceipt(t, true) });
  } else {
    tools.innerHTML = `<div class="card mut">Trasferta chiusa: l'amministrazione la vede già. Scarica l'Excel, controllalo, modificalo se serve e firmalo.</div>
      <div class="actions"><button class="btn" id="xl">⬇ Scarica Excel</button><button class="btn" id="zp">⬇ Scarica foto scontrini (ZIP)</button><button class="btn sec" id="reopen">Riapri trasferta</button></div>`;
    const run = (bid, fn) => document.getElementById(bid).onclick = guard(async ev => {
      ev.target.disabled = true; try { await fn(); } catch (e) { if (e instanceof AuthError) throw e; toast('Errore: ' + e.message); } ev.target.disabled = false;
    });
    run('xl', async () => NS.deliver(await NS.buildExcel(t), `Nota_Spese_${NS.baseName(t)}.xlsx`));
    run('zp', async () => NS.deliver(await NS.buildZip(t, getPhoto), `Scontrini_${NS.baseName(t)}.zip`));
    run('reopen', async () => { await api(`/trips/${id}/reopen`, { method: 'POST' }); viewTrip(id); });
  }
});

function showPhoto(b) {
  const el = document.createElement('div'); el.className = 'sheet viewer';
  el.innerHTML = `<button class="link" id="c">← Chiudi</button><img src="${URL.createObjectURL(b)}" alt="Scontrino">`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey); document.body.append(el);
  el.querySelector('#c').onclick = close; el.onclick = e => { if (e.target === el) close(); };
}

function editTrip(t) {
  setHeader('Modifica trasferta', () => viewTrip(t.id));
  $app.innerHTML = `<div class="card narrow">${tripForm(t)}<div class="actions" style="margin-top:16px"><button class="btn" id="save">Salva</button></div></div>`;
  document.getElementById('save').onclick = guard(async () => {
    try { await api('/trips/' + t.id, { method: 'PATCH', body: readTripForm() }); viewTrip(t.id); } catch (e) { if (e instanceof AuthError) throw e; toast(e.message); }
  });
}

// ================= aggiungi giustificativo: fotocamera → dati a mano =================
function addReceipt(t, noPhoto) {
  if (t.expenses.length >= MAX_ROWS) return toast(`Il modulo ha spazio per ${MAX_ROWS} spese: apri una nuova nota spese.`);
  if (noPhoto) return receiptSheet(t, null);   // fattura o pagamento senza scontrino: nessuna foto
  // L'input deve stare nella pagina: su iPhone (soprattutto dalla home) un input non agganciato viene eliminato prima che arrivi la foto.
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');   // fotocamera posteriore
  inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px';
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.remove();
    if (!f) return;
    try { receiptSheet(t, await shrink(f)); } catch (e) { toast('Foto non leggibile: ' + e.message); }
  });
  inp.addEventListener('cancel', () => inp.remove());
  inp.click();
}
async function loadImage(file) {
  try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: b, w: b.width, h: b.height }; } catch {}
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url;
  try { await img.decode(); } catch { throw new Error('formato immagine non supportato'); }
  URL.revokeObjectURL(url); return { src: img, w: img.naturalWidth, h: img.naturalHeight };
}
// ridimensiona (max 1600px) e comprime: scontrino leggibile, ~300 KB, entra nei limiti del server. Restituisce {blob, dataUrl}
async function shrink(file, max = 1600) {
  const im = await loadImage(file);
  const k = Math.min(1, max / Math.max(im.w, im.h));
  const c = document.createElement('canvas'); c.width = Math.round(im.w * k); c.height = Math.round(im.h * k);
  c.getContext('2d').drawImage(im.src, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.82);
  if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('compressione fallita');
  return { dataUrl, blob: await (await fetch(dataUrl)).blob() };
}

function receiptSheet(t, photo) {
  const s = { category: null, reason: null, payment: PAYMENTS.includes(ls.get('ns_lastpay')) ? ls.get('ns_lastpay') : null };
  const d0 = today() >= t.date_from && today() <= t.date_to ? today() : t.date_from;
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${photo ? 'Nuovo giustificativo' : 'Spesa senza foto'}">
    <div class="dlg-head"><b class="big">${photo ? 'Nuovo giustificativo' : 'Spesa senza foto'}</b><button class="link" id="x">Annulla</button></div>
    <div class="dlg-body">
      ${photo ? `<div class="dlg-photo"><img class="preview" id="pv" src="${URL.createObjectURL(photo.blob)}" alt="Scontrino"><div class="mut">Tocca la foto per ingrandirla</div></div>`
      : `<div class="dlg-photo"><div class="card"><label>Giustificativo *</label>
          <div class="chips wide">${REASONS.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
          <div class="mut" style="margin-top:10px">Per spese senza foto dello scontrino: questa scelta comparirà nella colonna «Giustificativo» dell'Excel.</div></div></div>`}
      <div class="dlg-form">
        <label>Tipologia di spesa *</label>
        <div class="chips">${CATEGORIES.map(c => `<button type="button" class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div class="grid2"><div><label>Data *</label><input id="r_date" type="date" value="${d0}"></div>
          <div><label>Importo € *</label><input id="r_amt" inputmode="decimal" placeholder="0,00"></div></div>
        <label>Metodo di pagamento *</label>
        <div class="chips">${PAYMENTS.map(p => `<button type="button" class="chip${p === s.payment ? ' on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <label>Descrizione</label><input id="r_desc" autocomplete="off" placeholder="es. Pranzo con cliente">
        <label>Note</label><input id="r_notes" autocomplete="off" placeholder="es. importo originale 45 CHF">
      </div>
    </div>
    <div class="dlg-foot"><button class="btn" id="ok" disabled>${photo ? 'Salva giustificativo' : 'Salva spesa'}</button></div></div>`;
  document.body.append(el);
  const q = id => el.querySelector('#' + id);
  const refresh = () => { q('ok').disabled = !((photo || s.reason) && s.category && s.payment && q('r_date').value && num(q('r_amt').value) > 0); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.viewer')) closeSheet(); };
  const closeSheet = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  q('x').onclick = closeSheet; if (photo) q('pv').onclick = () => showPhoto(photo.blob);
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { s.reason = b.dataset.r; el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { s.category = b.dataset.c; el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { s.payment = b.dataset.p; el.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  ['r_date', 'r_amt'].forEach(i => q(i).oninput = refresh);
  refresh();

  q('ok').onclick = async () => {
    q('ok').disabled = true;
    try {
      const date = q('r_date').value, amount = num(q('r_amt').value);
      if (!isDate(date)) throw new Error('Data non valida');
      if (!(amount > 0) || amount > 100000) throw new Error('Importo non valido');
      if ((date < t.date_from || date > t.date_to) && !confirm(`La data (${dIt(date)}) è fuori dal periodo della trasferta. Salvare lo stesso?`)) { q('ok').disabled = false; return; }
      q('ok').textContent = 'Salvataggio…';
      await api(`/trips/${t.id}/expenses`, { method: 'POST', body: { date, category: s.category, payment: s.payment, amount,
        description: q('r_desc').value, notes: q('r_notes').value, ...(photo ? { photo: photo.dataUrl } : { reason: s.reason }) } });
      ls.set('ns_lastpay', s.payment); closeSheet(); viewTrip(t.id);
    } catch (err) {
      if (err instanceof AuthError) { closeSheet(); return viewLogin(err.message); }   // la foto non va persa: dopo il codice si rifà lo scatto
      toast(err.message); q('ok').disabled = false; q('ok').textContent = photo ? 'Salva giustificativo' : 'Salva spesa';
    }
  };
}

// ================= avvio =================
ls.get('ns_token') ? viewDashboard() : viewLogin();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
