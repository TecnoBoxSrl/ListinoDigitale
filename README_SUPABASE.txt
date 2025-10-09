LISTINO DIGITALE – Supabase Edition (pacchetto minimo)
Contiene:
- index.html (UI + auth)
- script.js (fetch sicuro da Supabase, solo lettura per agenti)
- sw.js (PWA senza cache per Supabase)
- supabase_schema.sql (schema + RLS)
- functions/publish_price_list.ts, functions/notify_agents.ts (scheletri)
Passi: crea progetto, lancia SQL, imposta bucket 'media' (privato), crea utenti/ruoli, deploy funzioni, inserisci URL/anon key in script.js, pubblica su GitHub Pages.

FAQ rapidissima
----------------
- **Se dopo le ultime correzioni tutto funziona, devo applicare ulteriori modifiche?**
  No: se l'app mostra correttamente i prodotti anche su desktop vuol dire che l'aggiornamento del service worker e degli asset è andato a buon fine. Non è necessario intervenire ancora, ma ricorda di forzare un refresh completo del browser (Ctrl/Cmd+Shift+R) per essere certo che stai usando la build più recente.
- **Quindi devo aggiornare anche il ramo Git?**
  No: una volta che l'ambiente locale carica i prodotti con la build corretta non serve spostarsi su un altro branch né aggiornarlo.
  Continua a lavorare sul ramo corrente; l'importante è effettuare un reload completo del browser così da scaricare il nuovo service worker e i file aggiornati.
