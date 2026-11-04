import crypto from 'node:crypto';
import { query, ConfigError } from './db.js';

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new ConfigError('Configurazione incompleta: manca SESSION_SECRET (almeno 16 caratteri). Aggiungila nelle variabili d\'ambiente e rifai il deploy.');
  return s;
};
const b64 = b => Buffer.from(b).toString('base64url');
const mac = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Token firmato: non si può falsificare senza SESSION_SECRET. */
export function signToken(payload, ttlMs) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${mac(body)}`;
}
export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !same(sig, mac(body))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
export const checkPassword = (given, expected) => !!expected && same(
  crypto.createHash('sha256').update(String(given)).digest('hex'), crypto.createHash('sha256').update(expected).digest('hex'));

export const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();

// Freno ai tentativi: i codici corti si indovinano, quindi limitiamo per IP e in totale.
const WINDOW = 15 * 60_000, PER_IP = 8, GLOBAL = 60;
export async function assertNotLocked(kind, ip) {
  const since = Date.now() - WINDOW;
  const [r] = await query(`SELECT count(*) FILTER (WHERE ip = $2)::int AS ip_fail, count(*)::int AS all_fail
    FROM login_attempts WHERE kind = $1 AND ok = FALSE AND ts > $3`, [kind, ip, since]);
  if (r.ip_fail >= PER_IP || r.all_fail >= GLOBAL) throw Object.assign(new Error('Troppi tentativi. Riprova tra 15 minuti.'), { status: 429 });
}
export async function recordAttempt(kind, ip, ok) {
  await query('INSERT INTO login_attempts (kind, ip, ok, ts) VALUES ($1,$2,$3,$4)', [kind, ip, ok, Date.now()]);
  if (!ok) await query('DELETE FROM login_attempts WHERE ts < $1', [Date.now() - 24 * 3600_000]);
}

export async function requireEmployee(req, res, next) {
  const p = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (p?.k !== 'emp') return res.status(401).json({ error: 'Accesso scaduto: inserisci di nuovo il codice' });
  const [e] = await query('SELECT id, name, department FROM employees WHERE id = $1 AND active = TRUE', [p.id]);
  if (!e) return res.status(401).json({ error: 'Utente disattivato' });
  req.emp = e; next();
}
export function requireAdmin(req, res, next) {
  const p = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (p?.k !== 'admin') return res.status(401).json({ error: 'Accesso amministratore scaduto' });
  next();
}
