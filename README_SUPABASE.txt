LISTINO DIGITALE – Supabase Edition (pacchetto minimo)
Contiene:
- index.html (UI + auth)
- script.js (fetch sicuro da Supabase, solo lettura per agenti)
- sw.js (PWA senza cache per Supabase)
- supabase_schema.sql (schema + RLS)
- functions/publish_price_list.ts, functions/notify_agents.ts (scheletri)
Passi: crea progetto, lancia SQL, imposta bucket 'media' (privato), crea utenti/ruoli, deploy funzioni, inserisci URL/anon key in script.js, pubblica su GitHub Pages.
