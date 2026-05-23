# Revisione sicurezza e procedure – ListinoDigitale

Data revisione: 2026-05-23

## Criticità principali

1. **Chiavi e configurazione hardcoded nel frontend**
   - `SUPABASE_URL` e `SUPABASE_ANON_KEY` sono inserite in chiaro in `script.js`.
   - Rischio: scraping e abuso della quota API (anche se la anon key non è “segreta”, va comunque protetta da uso improprio via policy e rate limiting).

2. **Nessun controllo di autorizzazione nelle Edge Functions**
   - `publish_price_list.ts` e `notify_agents.ts` usano direttamente la `SERVICE_ROLE_KEY`, ma non verificano JWT, ruolo utente o firma webhook in ingresso.
   - Rischio: se endpoint esposto pubblicamente, invocazioni non autorizzate con privilegi massimi.

3. **Mancata gestione errori granulari su operazioni DB critiche**
   - In entrambe le funzioni non vengono verificati tutti gli `error` restituiti da Supabase dopo `insert/update/select`.
   - Rischio: inconsistenza silente (dati parziali, notifiche non allineate).

4. **Assenza di idempotenza nelle procedure di pubblicazione**
   - `publish_price_list` crea nuova versione e snapshot ad ogni invocazione, senza lock/logica anti-duplicato.
   - Rischio: versioni duplicate e notifiche multiple in caso di retry o doppio submit.

5. **Notifiche WhatsApp senza throttling/retry policy strutturata**
   - Ciclo sincrono su tutti gli agenti con `fetch` seriale e senza gestione puntuale dei codici risposta.
   - Rischio: timeouts, blocchi parziali, impossibilità di audit affidabile.

## Migliorie consigliate (priorità)

### P0 (immediato)
- Proteggere Edge Functions con una delle seguenti strategie:
  - validazione JWT utente + check ruolo `admin` su `profiles`, oppure
  - secret header HMAC per invocazioni server-to-server.
- Implementare controllo esplicito metodo HTTP e content-type accettati.
- Validare e sanificare payload input con schema (es. Zod) e limiti su dimensione batch.
- Gestire tutti gli errori Supabase (fail fast + risposta strutturata).

### P1 (breve termine)
- Rendere `publish_price_list` transazionale (RPC SQL / funzione Postgres) per garantire atomicità tra:
  - update prodotti,
  - scrittura change log,
  - snapshot versione.
- Aggiungere idempotency key (`x-idempotency-key`) e vincolo univoco lato DB.
- Log di audit: `who/when/from-ip/request-id/outcome`.

### P2 (hardening)
- Rate limiting per funzione (gateway o middleware).
- Coda asincrona per notifiche (task table + worker) invece di invio inline.
- Monitoraggio e alerting su error rate/latency.
- Revisione CSP/SRI per script CDN e policy di sicurezza browser.

## Checklist operativa suggerita

- [ ] Endpoint funzioni non invocabili anonimamente.
- [ ] Solo utenti `admin` possono pubblicare listini.
- [ ] Ogni pubblicazione è idempotente.
- [ ] Tutte le query critiche hanno controllo `error`.
- [ ] Tutte le notifiche sono tracciate con stato (pending/sent/failed).
- [ ] Dashboard con metriche minime (invocazioni, failure, tempo medio).

