# Nota Spese — versione con server (Vercel) e codici personali

**Impiegati** (`/`): entrano con il proprio **codice personale**, creano la nota spese, fotografano gli scontrini e inseriscono i dati a mano.
I dati e le foto sono salvati sul server: non si perdono se si cambia telefono o si cancella il browser.
**Amministratore** (`/admin.html`, con password): vede tutte le note spese di tutti, scarica Excel (sul vostro modulo) e ZIP delle foto, gestisce gli impiegati (aggiunge, cambia codice/reparto, disattiva).

## Messa online su Vercel
1. **Progetto**: vercel.com → *Add New → Project* → importa il repository GitHub `notaspesedupuy` (il progetto sta alla radice: **non serve** impostare Root Directory; Framework Preset: *Other*). Vercel pubblica in produzione dal ramo `main`.
2. **Database**: nel progetto → *Storage* → *Create Database* → **Neon (Postgres)** → collegalo al progetto (scegli una regione UE, es. Francoforte). Vercel aggiunge da solo la variabile `DATABASE_URL`. Le tabelle si creano da sole al primo avvio.
3. **Variabili d'ambiente** (*Settings → Environment Variables*):

| Nome | Valore |
|---|---|
| `SESSION_SECRET` | testo casuale lungo (almeno 32 caratteri); firma gli accessi. Se lo cambi, tutti devono rientrare col codice |
| `ADMIN_PASSWORD` | la password dell'area amministratore (lunga) |
| `SEED_EMPLOYEES` | impiegati iniziali, usata **solo se la tabella è vuota**: `Nome Cognome:codice:reparto, Altro Nome:codice` (il reparto è facoltativo) |

4. **Redeploy** dopo aver impostato le variabili. Apri `https://<progetto>.vercel.app/` (impiegati) e `/admin.html` (amministratore).
5. Dopo il primo avvio gli impiegati si gestiscono dalla pagina amministratore: `SEED_EMPLOYEES` non serve più.

## Sicurezza: da sapere
- **Codici di 4 cifre sono facili da indovinare** (10.000 combinazioni). Difese presenti: dopo 8 tentativi falliti lo stesso IP viene bloccato per 15 minuti e dopo 60 falliti complessivi si blocca l'accesso a tutti per 15 minuti. Non basta contro un attacco serio: **appena possibile usate codici più lunghi** (6-8 caratteri con lettere e numeri, dalla pagina amministratore → *Cambia codice*) o passate al login Microsoft.
- L'accesso dura 90 giorni sul telefono. **Disattivare un impiegato lo blocca subito**, anche se è già entrato.
- Un impiegato vede solo le proprie note spese e le proprie foto (verificato dai test). Solo l'amministratore vede tutto.
- "Elimina" dall'app è morbido: la nota spese sparisce per l'impiegato ma l'amministratore la vede ancora (filtro *Eliminate*).
- I codici sono visibili all'amministratore (servono per comunicarli). Il database contiene foto di scontrini: tenete la regione UE e l'accesso a Vercel/Neon limitato.
- Usare solo HTTPS (Vercel lo fa di serie).

## Limiti
- Serve connessione per usare l'app (niente più uso offline).
- **15 spese per trasferta** (righe del modulo). Importi in €: per valute estere si annota l'originale nelle Note.
- Le foto stanno nel database (circa 300 KB l'una). Il piano gratuito di Neon (0,5 GB) ne contiene circa 1.500: poi si passa a un piano a pagamento o si spostano le foto su Vercel Blob.
- Sublink aziendale: il sito deve inoltrare `/notespese/*` al progetto Vercel (rimuovendo il prefisso). I percorsi dell'app sono relativi.

## Sviluppo e test
```bash
npm install
npm test                          # 8 test API con Postgres in memoria (PGlite)
node test/e2e.cjs                 # browser reale: impiegato + amministratore (serve playwright)
SESSION_SECRET=... ADMIN_PASSWORD=... DATABASE_URL=... npm start    # locale su :3000
```

## Non ancora provato
Tutto è testato in locale con Postgres in memoria. **Non è mai stato messo su Vercel/Neon reali**: al primo deploy verificare, in ordine: login con un codice, creazione nota spese, scatto e salvataggio di uno scontrino, pagina `/admin.html`, download Excel e ZIP. Punti da controllare per primi se qualcosa non va: la regola di rewrite `/api/*` in `vercel.json` e la variabile `DATABASE_URL`.
