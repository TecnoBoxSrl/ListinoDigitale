LISTINO DIGITALE – Supabase Edition (pacchetto minimo)

Contiene:
- index.html (UI + auth)
- script.js (fetch sicuro da Supabase, solo lettura per agenti)
- product-data.js (helper che gestisce fallback colonne opzionali)
- sw.js (PWA senza cache per Supabase)
- supabase_schema.sql (schema + RLS)
- functions/publish_price_list.ts, functions/notify_agents.ts (scheletri)
- tests/ (coprono il fallback della query prodotti)

Passi:
1. Crea progetto, lancia SQL, imposta bucket "media" (privato) oppure aggiorna `STORAGE_BUCKET` in script.js.
2. Inserisci URL/anon key in script.js.
3. (Opzionale) Esegui `npm install && npm test` per verificare gli helper.
4. Pubblica gli asset statici su GitHub Pages (o hosting equivalente).

Consulta anche `README.md` per istruzioni dettagliate su struttura file, testing e deploy.
