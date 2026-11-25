// Verifica del token di accesso (id_token) emesso da Microsoft Entra ID, senza dipendenze esterne:
// firma RS256 con le chiavi pubbliche di Microsoft + controllo di emittente, destinatario, scadenza e nonce.
import crypto from 'node:crypto';

export const isGuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const cache = new Map();   // tenant → { keys, at }

async function getKeys(tenant, force) {
  const c = cache.get(tenant);
  if (!force && c && Date.now() - c.at < 3600_000) return c.keys;
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  if (!r.ok) throw new Error('chiavi pubbliche Microsoft non raggiungibili');
  const keys = (await r.json()).keys || [];
  cache.set(tenant, { keys, at: Date.now() });
  return keys;
}

/** Restituisce i dati (claims) del token oppure lancia un errore con il motivo (da non mostrare all'utente). */
export async function verifyIdToken(idToken, { tenant, clientId, nonce }) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('token malformato');
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { throw new Error('token illeggibile'); }
  if (header.alg !== 'RS256') throw new Error('algoritmo non ammesso: ' + header.alg);

  let jwk = (await getKeys(tenant)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(tenant, true)).find(k => k.kid === header.kid);   // Microsoft ruota le chiavi
  if (!jwk) throw new Error('chiave di firma sconosciuta');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('firma non valida');

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) throw new Error('emittente diverso: ' + claims.iss);
  if (claims.tid !== tenant) throw new Error('tenant diverso');
  if (claims.aud !== clientId) throw new Error('destinatario diverso');
  if (!(claims.exp > now)) throw new Error('token scaduto');
  if (claims.nbf && claims.nbf > now + 120) throw new Error('token non ancora valido');
  if (!nonce || claims.nonce !== nonce) throw new Error('nonce diverso');
  return claims;
}
