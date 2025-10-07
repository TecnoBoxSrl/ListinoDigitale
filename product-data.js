const PRODUCT_BASE_SELECT = `
        id,
        codice,
        descrizione,
        dimensione,
        categoria,
        sottocategoria,
        prezzo,
        conai,
        unita,
        disponibile,
        novita,
        pack,
        pallet,
        tags,
        updated_at,
        product_media(id,kind,path,sort)
      `;

const PRODUCT_FALLBACK_SELECT = `
        id,
        codice,
        descrizione,
        categoria,
        sottocategoria,
        prezzo,
        unita,
        disponibile,
        novita,
        pack,
        pallet,
        tags,
        updated_at,
        product_media(id,kind,path,sort)
      `;

function ensureClient(client){
  if (!client || typeof client.from !== 'function') {
    throw new Error('Supabase client non valido o mancante.');
  }
}

async function fetchProductsData(client, logger = console){
  ensureClient(client);
  const orderConfig = { ascending: true };

  const baseQuery = client
    .from('products')
    .select(PRODUCT_BASE_SELECT)
    .order('descrizione', orderConfig);

  const { data, error } = await baseQuery;
  if (!error) {
    return { data: data || [], usedFallback: false };
  }

  const warnLogger = logger && typeof logger.warn === 'function' ? logger : console;
  warnLogger.warn?.('[Data] fetchProducts warn, uso fallback senza colonne opzionali:', error.message || error);

  const fallbackQuery = client
    .from('products')
    .select(PRODUCT_FALLBACK_SELECT)
    .order('descrizione', orderConfig);

  const fallbackResult = await fallbackQuery;
  if (fallbackResult.error) {
    throw fallbackResult.error;
  }

  return { data: fallbackResult.data || [], usedFallback: true };
}

const ProductData = {
  PRODUCT_BASE_SELECT,
  PRODUCT_FALLBACK_SELECT,
  fetchProductsData,
};

if (typeof window !== 'undefined') {
  window.ProductData = ProductData;
}

export { PRODUCT_BASE_SELECT, PRODUCT_FALLBACK_SELECT, fetchProductsData };
export default ProductData;
