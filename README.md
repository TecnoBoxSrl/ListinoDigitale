# Listino Digitale – Guida rapida

Questa cartella contiene il pacchetto minimo del **Listino Digitale** pronto per essere pubblicato su una pagina statica (ad esempio GitHub Pages) collegato a un backend Supabase. Di seguito trovi come sono organizzati i file, cosa fanno e come avviarli in locale.

## Struttura dei file principali

| File / cartella              | Descrizione |
|------------------------------|-------------|
| `index.html`                 | Interfaccia dell'applicazione: login, ricerca prodotti e gestione preventivo. Il file include gli stili Tailwind precompilati e carica `script.js` come modulo ES.
| `script.js`                  | Logica dell'interfaccia. Si occupa dell'autenticazione Supabase, del caricamento dei prodotti e della gestione del carrello/preventivo nel browser.
| `product-data.js`            | Helper condiviso che esegue la query a Supabase. Il modulo prova prima la `select` completa (con campi opzionali `dimensione` e `conai`) e se la chiamata fallisce ripete l'operazione con un set minimo di colonne.
| `sw.js`                      | Service Worker che fornisce il comportamento PWA di base e mette in cache gli asset statici, inclusi `script.js` e `product-data.js`.
| `manifest.webmanifest`       | Manifest PWA usato quando installi l'app su dispositivi mobili.
| `functions/`                 | Bozze di Edge Function per pubblicare il listino e notificare gli agenti. Puoi usarle come punto di partenza nel progetto Supabase.
| `tests/`                     | Contiene i test Node (`node --test`) che verificano i percorsi di fallback in `product-data.js`.
| `supabase_schema.sql`        | Script SQL con schema tabelle, policy RLS e storage da eseguire nel progetto Supabase.
| `logo.svg`                   | Logo mostrato nell'interfaccia.

## Requisiti

* Node.js 18+ (necessario solo per lanciare i test automatizzati).
* Un progetto Supabase con tabelle e policy definite dal file `supabase_schema.sql`.

## Configurazione Supabase

1. Crea un nuovo progetto Supabase e carica lo script `supabase_schema.sql` dalla dashboard SQL.
2. Se utilizzi un bucket diverso da `prodotti`, aggiorna la costante `STORAGE_BUCKET` in `script.js`.
3. Inserisci il tuo **Project URL** e la **anon key** nelle costanti `SUPABASE_URL` e `SUPABASE_ANON_KEY` all'inizio di `script.js`.
4. (Opzionale) Distribuisci le funzioni in `functions/` usando il CLI Supabase per automatizzare la pubblicazione del listino.

## Avvio locale

Il progetto è completamente statico: basta aprire `index.html` da un server locale (ad esempio usando l'estensione "Live Server" di VS Code oppure `npx serve .`).

Assicurati che l'istanza Supabase sia raggiungibile dall'ambiente locale; al primo accesso l'app mostrerà il form di login email/password.

## Esecuzione dei test

Per verificare la correttezza dell'helper dei prodotti:

```bash
npm install
npm test
```

I test usano il runner nativo di Node (`node --test`) e controllano che il fallback della query a Supabase funzioni correttamente.

## Pubblicazione

1. Carica i file statici (`index.html`, `script.js`, `product-data.js`, `sw.js`, `manifest.webmanifest`, `logo.svg`) su un hosting statico.
2. Configura l'URL del Service Worker (`sw.js`) se l'hosting richiede percorsi particolari.
3. Ricorda di impostare le variabili Supabase direttamente nei file prima del deploy.

Con questi passaggi hai un quadro chiaro di come usare ogni file e puoi procedere sia con il testing che con la pubblicazione del listino digitale.
