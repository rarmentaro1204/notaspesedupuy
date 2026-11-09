import express from 'express';
import crypto from 'node:crypto';
import { query, dbConfigured } from '../lib/db.js';
import { signToken, checkPassword, clientIp, assertNotLocked, recordAttempt, requireEmployee, requireAdmin } from '../lib/auth.js';

export const CATEGORIES = ['Trasporti', 'Carburante', 'Pedaggi', 'Taxi', 'Parcheggio', 'Hotel', 'Pasti', 'Altro'];
export const PAYMENTS = ['Carta Aziendale', 'Carta Personale', 'Contanti', 'Bonifico'];
// Motivi ammessi per una spesa senza foto
export const REASONS = ['Fatturato', 'Prenotato online', 'Contactless (tap & go)', 'Altro'];
const MAX_ROWS = 15; // righe del modulo (14-28)

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));   // Vercel accetta richieste fino a 4,5 MB
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = v => (v === '' || v == null) ? null : Number(String(v).replace(',', '.'));
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

// ---------- accesso ----------
app.post('/api/login', async (req, res) => {
  const ip = clientIp(req); await assertNotLocked('emp', ip);
  const code = str(req.body.code, 40);
  const [e] = code ? await query('SELECT id, name, department FROM employees WHERE code = $1 AND active = TRUE', [code]) : [];
  await recordAttempt('emp', ip, !!e);
  if (!e) throw bad('Codice non valido', 401);
  res.json({ token: signToken({ k: 'emp', id: e.id }, 90 * 24 * 3600_000), name: e.name, department: e.department });
});
app.post('/api/admin/login', async (req, res) => {
  if (!process.env.ADMIN_PASSWORD) throw bad('ADMIN_PASSWORD non configurata', 503);
  const ip = clientIp(req); await assertNotLocked('admin', ip);
  const ok = checkPassword(req.body.password, process.env.ADMIN_PASSWORD);
  await recordAttempt('admin', ip, ok);
  if (!ok) throw bad('Password errata', 401);
  res.json({ token: signToken({ k: 'admin' }, 12 * 3600_000) });
});

// Diagnostica: dice cosa è configurato (mai i valori). Utile al primo deploy: apri /api/health
app.get('/api/health', async (req, res) => {
  const out = { sessionSecret: (process.env.SESSION_SECRET || '').length >= 16, adminPassword: !!process.env.ADMIN_PASSWORD, databaseUrl: dbConfigured() };
  try { out.employees = (await query('SELECT count(*)::int AS n FROM employees'))[0].n; out.database = 'ok'; }
  catch (e) { out.database = 'errore'; console.error('health:', e.message); }
  out.ok = out.sessionSecret && out.adminPassword && out.database === 'ok' && out.employees > 0;
  res.status(out.ok ? 200 : 503).json(out);
});

// ---------- accessori ----------
const TRIP_SQL = `SELECT t.id, t.client, t.destination, t.date_from, t.date_to, t.km_rate, t.km, t.status, t.created_at, t.closed_at, t.deleted,
    e.name AS emp_name, e.department AS emp_department, t.employee_id,
    (SELECT count(*)::int FROM expenses x WHERE x.trip_id = t.id) AS n_expenses,
    (SELECT COALESCE(SUM(x.amount), 0)::float FROM expenses x WHERE x.trip_id = t.id) AS total
  FROM trips t JOIN employees e ON e.id = t.employee_id`;
const EXP_SQL = 'SELECT id, trip_id, date, category, description, payment, amount, notes, reason, created_at, (photo IS NOT NULL) AS has_photo FROM expenses';
const tripDto = r => ({ id: r.id, client: r.client, destination: r.destination, date_from: r.date_from, date_to: r.date_to, km_rate: r.km_rate, km: r.km,
  status: r.status, created_at: r.created_at, closed_at: r.closed_at, deleted: r.deleted, n_expenses: r.n_expenses, total: r.total,
  owner: { id: r.employee_id, name: r.emp_name, department: r.emp_department } });

async function ownTrip(req) {
  const [t] = await query(TRIP_SQL + ' WHERE t.id = $1 AND t.employee_id = $2 AND t.deleted = FALSE', [req.params.id, req.emp.id]);
  if (!t) throw bad('Trasferta non trovata', 404);
  return t;
}
async function withExpenses(t) {
  return { ...tripDto(t), expenses: await query(EXP_SQL + ' WHERE trip_id = $1 ORDER BY date, created_at', [t.id]) };
}
function tripFields(b) {
  const f = { client: str(b.client), destination: str(b.destination), date_from: str(b.date_from, 10), date_to: str(b.date_to, 10), km_rate: num(b.km_rate), km: num(b.km) };
  if (!f.destination) throw bad('Indica il luogo della trasferta');
  if (!isDate(f.date_from) || !isDate(f.date_to)) throw bad('Date non valide');
  if (f.date_to < f.date_from) throw bad('La data di fine è precedente a quella di inizio');
  if ([f.km_rate, f.km].some(v => v != null && !(v >= 0))) throw bad('Km o tariffa non validi');
  return f;
}
function decodePhoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || m[1].length > 3_000_000) throw bad('Foto non valida o troppo grande');
  return m[1];
}

// ---------- impiegato ----------
const emp = express.Router();
emp.use(requireEmployee);
app.use('/api', (req, res, next) => req.path.startsWith('/admin') || req.path === '/login' || req.path === '/health' ? next() : emp(req, res, next));

emp.get('/me', (req, res) => res.json(req.emp));
emp.get('/trips', async (req, res) => {
  const rows = await query(TRIP_SQL + ' WHERE t.employee_id = $1 AND t.deleted = FALSE ORDER BY t.date_from DESC, t.created_at DESC', [req.emp.id]);
  res.json(rows.map(tripDto));
});
emp.post('/trips', async (req, res) => {
  const f = tripFields(req.body), id = uid();
  await query(`INSERT INTO trips (id, employee_id, client, destination, date_from, date_to, km_rate, km, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, req.emp.id, f.client, f.destination, f.date_from, f.date_to, f.km_rate, f.km, now()]);
  res.status(201).json(await withExpenses(await ownTrip({ params: { id }, emp: req.emp })));
});
emp.get('/trips/:id', async (req, res) => res.json(await withExpenses(await ownTrip(req))));
emp.patch('/trips/:id', async (req, res) => {
  const t = await ownTrip(req);
  if (t.status !== 'open') throw bad('Trasferta chiusa: riaprila per modificarla');
  const f = tripFields({ ...t, ...req.body });
  await query('UPDATE trips SET client=$1, destination=$2, date_from=$3, date_to=$4, km_rate=$5, km=$6 WHERE id=$7',
    [f.client, f.destination, f.date_from, f.date_to, f.km_rate, f.km, t.id]);
  res.json(await withExpenses(await ownTrip(req)));
});
emp.delete('/trips/:id', async (req, res) => {   // cancellazione "morbida": resta traccia per l'amministratore
  const t = await ownTrip(req);
  if (t.status !== 'open') throw bad('Trasferta chiusa');
  await query('UPDATE trips SET deleted = TRUE WHERE id = $1', [t.id]);
  res.status(204).end();
});
emp.post('/trips/:id/close', async (req, res) => {
  const t = await ownTrip(req);
  if (!t.n_expenses) throw bad('Aggiungi almeno un giustificativo prima di chiudere');
  await query("UPDATE trips SET status='closed', closed_at=$1 WHERE id=$2", [now(), t.id]);
  res.json(await withExpenses(await ownTrip(req)));
});
emp.post('/trips/:id/reopen', async (req, res) => {
  const t = await ownTrip(req);
  await query("UPDATE trips SET status='open', closed_at=NULL WHERE id=$1", [t.id]);
  res.json(await withExpenses(await ownTrip(req)));
});

emp.post('/trips/:id/expenses', async (req, res) => {
  const t = await ownTrip(req), b = req.body;
  if (t.status !== 'open') throw bad('Trasferta chiusa');
  if (t.n_expenses >= MAX_ROWS) throw bad(`Il modulo ha spazio per ${MAX_ROWS} spese: apri una nuova nota spese`);
  const e = { date: str(b.date, 10), category: str(b.category), payment: str(b.payment), description: str(b.description, 120), notes: str(b.notes), amount: num(b.amount) };
  if (!isDate(e.date)) throw bad('Data non valida');
  if (!CATEGORIES.includes(e.category)) throw bad('Scegli la tipologia di spesa');
  if (!PAYMENTS.includes(e.payment)) throw bad('Scegli il metodo di pagamento');
  if (!(e.amount > 0) || e.amount > 100000) throw bad('Importo non valido');
  e.amount = Math.round(e.amount * 100) / 100;
  // Foto facoltativa: senza foto (fattura, prenotazione online, tap & go) serve indicare il motivo
  let photo = null, reason = '';
  if (b.photo) photo = decodePhoto(b.photo);
  else { reason = str(b.reason, 40); if (!REASONS.includes(reason)) throw bad('Indica perché non c\'è la foto'); }
  const id = uid();
  await query(`INSERT INTO expenses (id, trip_id, date, category, description, payment, amount, notes, reason, photo, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,decode($10,'base64'),$11)`, [id, t.id, e.date, e.category, e.description, e.payment, e.amount, e.notes, reason, photo, now()]);
  const [row] = await query(EXP_SQL + ' WHERE id = $1', [id]);
  res.status(201).json(row);
});
async function ownExpense(req) {
  const [e] = await query(`SELECT x.id, x.trip_id, t.status FROM expenses x JOIN trips t ON t.id = x.trip_id
    WHERE x.id = $1 AND t.employee_id = $2 AND t.deleted = FALSE`, [req.params.id, req.emp.id]);
  if (!e) throw bad('Spesa non trovata', 404);
  return e;
}
emp.delete('/expenses/:id', async (req, res) => {
  const e = await ownExpense(req);
  if (e.status !== 'open') throw bad('Trasferta chiusa');
  await query('DELETE FROM expenses WHERE id = $1', [e.id]);
  res.status(204).end();
});
async function sendPhoto(res, id) {
  const [r] = await query("SELECT encode(photo,'base64') AS b FROM expenses WHERE id = $1 AND photo IS NOT NULL", [id]);
  if (!r) throw bad('Foto non disponibile', 404);
  res.type('image/jpeg').set('Cache-Control', 'private, max-age=3600').send(Buffer.from(r.b, 'base64'));
}
emp.get('/expenses/:id/photo', async (req, res) => { const e = await ownExpense(req); await sendPhoto(res, e.id); });

// ---------- amministratore ----------
const adm = express.Router();
adm.use(requireAdmin);
app.use('/api/admin', (req, res, next) => req.path === '/login' ? next() : adm(req, res, next));

adm.get('/employees', async (req, res) => res.json(await query(
  `SELECT e.id, e.name, e.department, e.code, e.active, (SELECT count(*)::int FROM trips t WHERE t.employee_id = e.id AND NOT t.deleted) AS n_trips
   FROM employees e ORDER BY e.name`)));
adm.post('/employees', async (req, res) => {
  const name = str(req.body.name, 100), code = str(req.body.code, 40), department = str(req.body.department, 100);
  if (!name) throw bad('Indica nome e cognome');
  if (!/^[A-Za-z0-9]{4,40}$/.test(code)) throw bad('Il codice deve avere almeno 4 caratteri (lettere o numeri)');
  try {
    const [e] = await query('INSERT INTO employees (name, code, department, created_at) VALUES ($1,$2,$3,$4) RETURNING id, name, department, code, active', [name, code, department, now()]);
    res.status(201).json(e);
  } catch (err) { if (/unique|duplicate/i.test(err.message)) throw bad('Questo codice è già usato da un altro impiegato'); throw err; }
});
adm.patch('/employees/:id', async (req, res) => {
  const [cur] = await query('SELECT * FROM employees WHERE id = $1', [Number(req.params.id)]);
  if (!cur) throw bad('Impiegato non trovato', 404);
  const b = req.body, name = b.name != null ? str(b.name, 100) : cur.name, department = b.department != null ? str(b.department, 100) : cur.department;
  const code = b.code != null ? str(b.code, 40) : cur.code, active = b.active != null ? !!b.active : cur.active;
  if (!name) throw bad('Indica nome e cognome');
  if (!/^[A-Za-z0-9]{4,40}$/.test(code)) throw bad('Il codice deve avere almeno 4 caratteri (lettere o numeri)');
  try { await query('UPDATE employees SET name=$1, department=$2, code=$3, active=$4 WHERE id=$5', [name, department, code, active, cur.id]); }
  catch (err) { if (/unique|duplicate/i.test(err.message)) throw bad('Questo codice è già usato da un altro impiegato'); throw err; }
  res.json({ id: cur.id, name, department, code, active });
});
adm.get('/trips', async (req, res) => {
  res.json((await query(TRIP_SQL + ' ORDER BY t.created_at DESC LIMIT 500')).map(tripDto));
});
adm.get('/trips/:id', async (req, res) => {
  const [t] = await query(TRIP_SQL + ' WHERE t.id = $1', [req.params.id]);
  if (!t) throw bad('Trasferta non trovata', 404);
  res.json(await withExpenses(t));
});
adm.get('/expenses/:id/photo', async (req, res) => sendPhoto(res, req.params.id));

app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Errore del server' : err.message });
});

// Esecuzione locale (node api/index.js): serve anche le pagine statiche. Su Vercel le pagine le serve Vercel.
if (!process.env.VERCEL && process.argv[1] === new URL(import.meta.url).pathname) {
  app.use(express.static(new URL('../public/', import.meta.url).pathname));
  app.listen(process.env.PORT || 3000, () => console.log('Nota spese su http://localhost:' + (process.env.PORT || 3000)));
}
export default app;
