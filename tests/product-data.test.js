import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProductsData, PRODUCT_BASE_SELECT, PRODUCT_FALLBACK_SELECT } from '../product-data.js';

const nullLogger = { warn() {} };

function createClient(resolvers = {}) {
  return {
    from(table) {
      assert.equal(table, 'products');
      return {
        select(select) {
          return {
            order(column, options) {
              assert.equal(column, 'descrizione');
              assert.deepEqual(options, { ascending: true });
              const resolver = resolvers[select];
              if (!resolver) {
                throw new Error(`Nessun resolver definito per la select: ${select}`);
              }
              return resolver();
            },
          };
        },
      };
    },
  };
}

test('fetchProductsData usa la select completa quando disponibile', async () => {
  const rows = [{ id: 1, codice: 'A', conai: 2.5 }];
  const client = createClient({
    [PRODUCT_BASE_SELECT]: () => ({ data: rows, error: null }),
  });

  const result = await fetchProductsData(client, nullLogger);
  assert.deepEqual(result, { data: rows, usedFallback: false });
});

test('fetchProductsData ricorre al fallback quando la select completa fallisce', async () => {
  const rows = [{ id: 2, codice: 'B' }];
  const client = createClient({
    [PRODUCT_BASE_SELECT]: () => ({ data: null, error: { message: 'column "dimensione" does not exist' } }),
    [PRODUCT_FALLBACK_SELECT]: () => ({ data: rows, error: null }),
  });

  let warned = false;
  const logger = {
    warn: () => {
      warned = true;
    },
  };

  const result = await fetchProductsData(client, logger);
  assert.ok(warned, 'il logger.warn deve essere chiamato quando si usa il fallback');
  assert.deepEqual(result, { data: rows, usedFallback: true });
});

test('fetchProductsData propaga l\'errore del fallback se anch\'esso fallisce', async () => {
  const fallbackError = new Error('fallback KO');
  const client = createClient({
    [PRODUCT_BASE_SELECT]: () => ({ data: null, error: { message: 'column missing' } }),
    [PRODUCT_FALLBACK_SELECT]: () => ({ data: null, error: fallbackError }),
  });

  await assert.rejects(() => fetchProductsData(client, nullLogger), fallbackError);
});

test('fetchProductsData richiede un client valido', async () => {
  await assert.rejects(() => fetchProductsData(null, nullLogger), /Supabase client non valido/);
});
