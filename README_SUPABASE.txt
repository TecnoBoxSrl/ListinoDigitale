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

Perché non funzionava prima
---------------------------
- Lo script carica la libreria Supabase UMD dal CDN, che espone un oggetto globale `supabase` usato per creare il client. Nel codice applicativo era stato dichiarato un identificatore locale con lo stesso nome per tenere il client creato. Questa collisione faceva sì che, appena la libreria veniva caricata in modo asincrono (tipico dopo la riattivazione del progetto Supabase e con il service worker che serviva asset cache), il riferimento globale venisse sovrascritto dal client locale.
- Quando l'oggetto globale veniva sovrascritto, le chiamate successive a `supabase.createClient` fallivano perché il nome puntava già a un'istanza parziale o a `null`. Il risultato erano errori in console e impossibilità di completare il login, soprattutto dopo periodi di pausa del progetto o con cache del browser stale.
- Rinominando la variabile del client in `supabaseClient` il nome globale del CDN resta intatto (`window.supabase`), e il codice usa in modo chiaro `window.supabase.createClient(...)` una sola volta. In questo modo il flusso di autenticazione resta stabile anche dopo che Supabase è stato sospeso e riattivato.
