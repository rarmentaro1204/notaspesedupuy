// Database Postgres. In produzione: Neon (collegato da Vercel → Storage). Nei test: PGlite (Postgres in memoria).
// Regole per restare compatibili con entrambi: date come testo 'YYYY-MM-DD', foto come bytea passato/letto in base64.
let ready;

async function connect() {
  if (process.env.TEST_PGLITE) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    return async (text, params = []) => (await db.query(text, params)).rows;
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL non configurata');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return (text, params = []) => sql.query(text, params);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS employees (
     id SERIAL PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL DEFAULT '',
     code TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS trips (
     id TEXT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
     client TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL, date_from TEXT NOT NULL, date_to TEXT NOT NULL,
     km_rate DOUBLE PRECISION, km DOUBLE PRECISION, status TEXT NOT NULL DEFAULT 'open',
     created_at TEXT NOT NULL, closed_at TEXT, deleted BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE IF NOT EXISTS expenses (
     id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
     date TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', payment TEXT NOT NULL,
     amount DOUBLE PRECISION NOT NULL, notes TEXT NOT NULL DEFAULT '',
     photo BYTEA, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id SERIAL PRIMARY KEY, kind TEXT NOT NULL, ip TEXT NOT NULL, ok BOOLEAN NOT NULL, ts BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS expenses_trip ON expenses(trip_id)`,
  `CREATE INDEX IF NOT EXISTS trips_emp ON trips(employee_id)`,
];

async function init() {
  const q = await connect();
  for (const s of SCHEMA) await q(s);
  // Primo avvio: impiegati iniziali da SEED_EMPLOYEES = "Nome Cognome:codice:reparto, Altro Nome:codice"
  const [{ n }] = await q('SELECT count(*)::int AS n FROM employees');
  if (!n && process.env.SEED_EMPLOYEES) {
    for (const item of process.env.SEED_EMPLOYEES.split(',')) {
      const [name, code, department = ''] = item.split(':').map(s => s.trim());
      if (name && code) await q('INSERT INTO employees (name, code, department, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [name, code, department, new Date().toISOString()]);
    }
  }
  return q;
}

export const query = async (text, params) => (await (ready ??= init().catch(e => { ready = undefined; throw e; })))(text, params);
