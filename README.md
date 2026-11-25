# Nota Spese — versione con server (Vercel) e codici personali

**Impiegati** (`/`): entrano con il proprio **codice personale**, creano la nota spese, fotografano gli scontrini e inseriscono i dati a mano.
I dati e le foto sono salvati sul server: non si perdono se si cambia telefono o si cancella il browser.
**Amministratore** (`/admin.html`, con password): vede tutte le note spese di tutti, scarica Excel (sul vostro modulo) e ZIP delle foto, gestisce gli impiegati (aggiunge, cambia codice/reparto, disattiva).

**Spese senza foto**: accanto a «+ Aggiungi giustificativo» c'è «Senza foto». Serve scegliere il giustificativo: **Fattura** oppure **Pagamento senza scontrino**. Nell'Excel quel testo compare nella colonna *Giustificativo* (per le spese con foto c'è *SI*); nello ZIP non c'è nessuna foto per quella riga. Contano comunque nelle 15 righe del modulo.

## Messa online su Vercel
1. **Progetto**: vercel.com → *Add New → Project* → importa il repository GitHub `notaspesedupuy` (il progetto sta alla radice: **non serve** impostare Root Directory; Framework Preset: *Other*). Vercel pubblica in produzione dal ramo `main`.
2. **Database**: nel progetto → *Storage* → *Create Database* → **Neon (Postgres)** → collegalo al progetto (scegli una regione UE, es. Francoforte). Vercel aggiunge da solo la variabile `DATABASE_URL`. Le tabelle si creano da sole al primo avvio.
3. **Variabili d'ambiente** (*Settings → Environment Variables*):

| Nome | Valore |
|---|---|
| `SESSION_SECRET` | testo casuale lungo (almeno 32 caratteri); firma gli accessi. Se lo cambi, tutti devono rientrare col codice |
| `ADMIN_PASSWORD` | la password dell'area amministratore (lunga) |
| `SEED_EMPLOYEES` | impiegati iniziali, usata **solo se la tabella è vuota**: `Nome Cognome:codice:reparto:email, Altro Nome:codice` (reparto ed e-mail sono facoltativi) |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` | *facoltative*: attivano «Accedi con Microsoft» (vedi sezione sotto) |

4. **Redeploy** dopo aver impostato le variabili. Apri `https://<progetto>.vercel.app/` (impiegati) e `/admin.html` (amministratore).
5. Dopo il primo avvio gli impiegati si gestiscono dalla pagina amministratore: `SEED_EMPLOYEES` non serve più.

## Accesso con Microsoft (Outlook / Microsoft 365) — facoltativo
Se configurato, nella schermata di accesso compare **Accedi con Microsoft**; il **codice personale resta valido** come alternativa. Se non è configurato non compare nulla e tutto funziona come prima.
L'impiegato entra solo se l'amministratore ha registrato la sua **e-mail** (pagina `/admin.html` → *Impiegati* → campo *E-mail* o pulsante *E-mail*): serve l'indirizzo con cui accede a Outlook/Microsoft 365 (di norma il nome utente, es. `nome@azienda.it`). Chi ha un account Microsoft valido ma nessuna e-mail registrata vede un messaggio che lo invita a chiedere all'amministratore.

**Da fare una volta, da un amministratore di Microsoft 365** (portale <https://entra.microsoft.com> → *App registrations* → *New registration*):
1. Nome a piacere (es. «Nota Spese»). *Supported account types*: **Accounts in this organizational directory only** (solo la vostra azienda).
2. *Redirect URI*: tipo **Single-page application (SPA)** — non «Web» — con l'indirizzo dell'app **con la "/" finale**, es. `https://notaspesedupuy.vercel.app/`. Se l'app è raggiungibile anche da un altro indirizzo (dominio aziendale, sublink) aggiungere anche quello: ogni indirizzo va registrato.
3. Non servono segreti né permessi aggiuntivi (bastano quelli di accesso già inclusi: openid, profile, email) e non serve il «consenso amministratore».
4. Dalla pagina *Overview* copiare **Application (client) ID** e **Directory (tenant) ID**.
5. Su Vercel (*Settings → Environment Variables*) aggiungere `AZURE_CLIENT_ID` e `AZURE_TENANT_ID` con quei due valori (sono pubblici, non segreti) e fare **Redeploy**. `AZURE_TENANT_ID` deve essere l'ID in formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (non «common» né il nome del dominio).

Come funziona e cosa è verificato: il browser porta l'impiegato su Microsoft, che lo rimanda all'app con un token; il server controlla la firma del token con le chiavi pubbliche di Microsoft e che emittente, destinatario, scadenza e *nonce* siano quelli attesi, poi cerca l'impiegato con quell'e-mail. Un token falso, scaduto, di un'altra app o di un altro tenant viene rifiutato (test automatici). `/api/health` mostra `"microsoft": true` quando è attivo.
Messaggio d'errore frequente: «l'app deve essere registrata come Single-page application» → il Redirect URI è stato creato con tipo *Web* o l'indirizzo non coincide.

## Se compare "Errore del server" o "Configurazione incompleta"
Apri `https://<progetto>.vercel.app/api/health`: mostra cosa è configurato (mai i valori). Deve dire `"ok": true`.
- `sessionSecret: false` → manca `SESSION_SECRET` (almeno 16 caratteri).
- `adminPassword: false` → manca `ADMIN_PASSWORD`.
- `databaseUrl: false` → il database non è collegato al progetto (Storage → collega Neon).
- `database: "errore"` → l'indirizzo c'è ma la connessione fallisce: i dettagli sono in *Vercel → Logs* (filtra per errori).
- `employees: 0` → `SEED_EMPLOYEES` mancante o impostata dopo il primo avvio: aggiungi gli impiegati da `/admin.html`.
Dopo ogni modifica alle variabili serve un **Redeploy**.

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
npm test                          # test API e login Microsoft con Postgres in memoria (PGlite)
node test/e2e.cjs                 # browser reale: impiegato + amministratore (serve playwright)
node test/e2e-microsoft.cjs       # browser reale: login Microsoft con Microsoft simulato
SESSION_SECRET=... ADMIN_PASSWORD=... DATABASE_URL=... npm start    # locale su :3000
```

## Cosa non è stato provato con servizi reali
Tutto è coperto da test automatici in locale (Postgres in memoria, browser simulato). L'app è in uso su Vercel con Neon, ma **il login Microsoft non è mai stato provato con un tenant Microsoft reale** (solo con un Microsoft simulato): al primo giro usare un account di prova già registrato in *Impiegati*. Se qualcosa non va, controllare per primi la registrazione dell'app (tipo *Single-page application* e Redirect URI identico all'indirizzo) e `/api/health`.
