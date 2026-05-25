/**
 * InventoryBridge — READ-ONLY bridge entre o bot e o catálogo de produtos.
 * Zero escrita: nenhum INSERT, UPDATE ou DELETE.
 *
 * Arquitetura multi-tenant:
 * - Toda consulta recebe storeId para garantir isolamento entre lojas.
 * - DEFAULT_STORE_ID = 'fluxo-outlet' (loja padrão enquanto há apenas uma loja).
 * - Fluxo Outlet usa o Supabase do site (SITE_SUPABASE_URL) como fonte atual.
 * - Futuras lojas usarão o Supabase do próprio bot com store_id.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BotProduct, BotProductSearchFilters, SiteProductRow } from './inventoryTypes';
import { mapMany, mapSiteProductToBotProduct } from './inventoryMapper';
import { normalizeText, normalizeSize } from './inventoryUtils';

// ── Loja padrão — usada enquanto o bot atende apenas a Fluxo Outlet ──────────
export const DEFAULT_STORE_ID = 'fluxo-outlet';

// ── Cliente Supabase do SITE da Fluxo Outlet (anon key — somente leitura) ────
// Fonte atual de produtos enquanto o catálogo vive no Supabase do site.
// Quando o cliente migrar para o painel SaaS, isso pode ser removido.
let _siteClient: SupabaseClient | null = null;

function getSiteClient(): SupabaseClient | null {
  if (_siteClient) return _siteClient;
  const url = process.env.SITE_SUPABASE_URL;
  const key = process.env.SITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[InventoryBridge] SITE_SUPABASE_URL ou SITE_SUPABASE_ANON_KEY não configurados — inventário desativado');
    return null;
  }
  _siteClient = createClient(url, key);
  return _siteClient;
}

// ── Mapa categoria → valor exato no banco (uppercase conforme DB do site) ─────
// Padrões aplicados sobre texto NORMALIZADO (sem acento, minúsculo)
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/\b(camis[ae]t?a?|polo|regata|blusa)\b/, 'CAMISA'],
  [/\btenis\b/,                              'TÊNIS'],
  [/\bbermuda\b/,                            'BERMUDA'],
  [/\bcalca\b/,                              'CALÇA'],
  [/\bchinelo\b/,                            'CHINELO'],
  [/oculos/,                                 'ÓCULOS '],  // trailing space como está no banco
  [/\b(kit|combo)\b/,                        'KITS'],
];

function buildCategoryFilter(raw: string): string[] {
  const norm = normalizeText(raw);
  for (const [re, dbValue] of CATEGORY_MAP) {
    if (re.test(norm)) return [dbValue];
  }
  return [raw.trim().toUpperCase()];
}

// ── Query base (somente produtos com estoque) ─────────────────────────────────
function baseQuery(client: SupabaseClient) {
  return client
    .from('products')
    .select('id,sku,name,price,category,image,stock,sizes,featured,subcategory,is_kit')
    .gt('stock', 0)
    .order('featured', { ascending: false })
    .order('name');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. searchProducts — busca livre no nome
// ─────────────────────────────────────────────────────────────────────────────
export async function searchProducts(storeId: string, query: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const { data, error } = await baseQuery(client)
    .ilike('name', `%${query}%`)
    .limit(10);

  if (error) {
    console.error(`[InventoryBridge][${storeId}] searchProducts error:`, error.message);
    return [];
  }
  return mapMany((data || []) as SiteProductRow[], storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getProductsByCategory — busca por categoria
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsByCategory(storeId: string, category: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const terms = buildCategoryFilter(category);
  const { data, error } = await baseQuery(client)
    .in('category', terms)
    .limit(50);

  if (error) {
    console.error(`[InventoryBridge][${storeId}] getProductsByCategory error:`, error.message);
    return [];
  }
  return mapMany((data || []) as SiteProductRow[], storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. getProductsBySize — produtos com tamanho em estoque (filtro em JS, JSONB)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsBySize(storeId: string, size: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const { data, error } = await baseQuery(client).limit(200);

  if (error) {
    console.error(`[InventoryBridge][${storeId}] getProductsBySize error:`, error.message);
    return [];
  }

  const sz = normalizeSize(size);
  const filtered = ((data || []) as SiteProductRow[]).filter(row =>
    (row.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0)
  );

  return mapMany(filtered, storeId).slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getProductAvailability — verifica disponibilidade de produto específico
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductAvailability(storeId: string, productId: string | number): Promise<BotProduct | null> {
  const client = getSiteClient();
  if (!client) return null;

  const { data, error } = await client
    .from('products')
    .select('id,sku,name,price,category,image,stock,sizes,featured,subcategory,is_kit')
    .eq('id', productId)
    .single();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error(`[InventoryBridge][${storeId}] getProductAvailability error:`, error?.message);
    }
    return null;
  }

  return mapSiteProductToBotProduct(data as SiteProductRow, storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. getProductForBotContext — filtros combinados (função central)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductForBotContext(storeId: string, filters: BotProductSearchFilters): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  let q = client
    .from('products')
    .select('id,sku,name,price,category,image,stock,sizes,featured,subcategory,is_kit')
    .gt('stock', 0)
    .order('featured', { ascending: false });

  if (filters.query) {
    q = q.ilike('name', `%${filters.query}%`);
  }

  if (filters.category) {
    const terms = buildCategoryFilter(filters.category);
    q = q.in('category', terms);
  }

  if (filters.maxPrice) {
    q = q.lte('price', filters.maxPrice);
  }

  if (filters.featuredOnly) {
    q = q.eq('featured', true);
  }

  const { data, error } = await q.limit(100);

  if (error) {
    console.error(`[InventoryBridge][${storeId}] getProductForBotContext error:`, error.message);
    return [];
  }

  let rows = (data || []) as SiteProductRow[];

  // Post-filtro por tamanho — normaliza ambos os lados
  if (filters.size) {
    const sz = normalizeSize(filters.size);
    rows = rows.filter(r =>
      (r.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0)
    );
  }

  // Post-filtro por cor — normaliza nome e filtro
  if (filters.color) {
    const cl = normalizeText(filters.color);
    rows = rows.filter(r => normalizeText(r.name).includes(cl));
  }

  return mapMany(rows, storeId).slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// findProductsForBot — função principal chamada pelo motor do bot
// Garante que NENHUMA consulta de produto ocorre sem contexto de loja (storeId)
// ─────────────────────────────────────────────────────────────────────────────
export async function findProductsForBot(storeId: string, filters: BotProductSearchFilters): Promise<BotProduct[]> {
  const hasSpecific = filters.category || filters.size || filters.query || filters.color;
  if (!hasSpecific) return [];
  return getProductForBotContext(storeId, filters);
}

// ─────────────────────────────────────────────────────────────────────────────
// formatProductsResponse — monta a resposta do bot a partir da lista
// ─────────────────────────────────────────────────────────────────────────────

const CAT_DISPLAY: Record<string, string> = {
  camisa: 'camisa', tenis: 'tênis', calca: 'calça',
  bermuda: 'bermuda', chinelo: 'chinelo', oculos: 'óculos', kit: 'kit',
};

export function formatProductsResponse(
  products: BotProduct[],
  filters: BotProductSearchFilters,
): string {
  if (products.length === 0) {
    return 'Não encontrei esse modelo disponível agora. Quer que eu veja opções parecidas?';
  }

  const catDisplay = filters.category ? (CAT_DISPLAY[filters.category] || filters.category) : null;
  const size  = filters.size;
  const color = filters.color;

  if (products.length === 1) {
    const p = products[0];
    const priceStr = p.price != null ? `R$${p.price.toFixed(2).replace('.', ',')}` : null;
    const sizesStr = p.sizes.length ? p.sizes.join(', ') : 'consultar';

    let msg = `*${p.name}*\n`;
    msg += priceStr ? `💰 ${priceStr}\n` : `💰 Vou confirmar o valor certinho pra você.\n`;
    msg += `📏 Tamanhos disponíveis: ${sizesStr}\n`;
    if (p.productUrl) msg += `🔗 ${p.productUrl}`;
    return msg;
  }

  if (catDisplay && size) {
    return (
      `Tenho opções em *${catDisplay}* no tamanho *${size}*. ` +
      `Quer ver as peças mais básicas ou as de destaque?\n\n` +
      products.slice(0, 5).map(p =>
        `• ${p.name}${p.price != null ? ` — R$${p.price.toFixed(2).replace('.', ',')}` : ''}`
      ).join('\n')
    );
  }

  if (catDisplay || color) {
    const line = catDisplay ? `em *${catDisplay}*` : `na cor *${color}*`;
    return (
      `Tenho algumas opções ${line}. Qual tamanho você usa?\n\n` +
      products.slice(0, 5).map(p => `• ${p.name}`).join('\n')
    );
  }

  return (
    `Encontrei ${products.length} opção(ões) pra você:\n\n` +
    products.slice(0, 5).map(p =>
      `• ${p.name}${p.price != null ? ` — R$${p.price.toFixed(2).replace('.', ',')}` : ''}`
    ).join('\n')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// detectProductQuery — extrai filtros de uma mensagem livre do cliente
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(camis[ae]t?a?|polo|regata|blusa)\b/, 'camisa'],
  [/\btenis\b/,                              'tenis'],
  [/\bbermuda\b/,                            'bermuda'],
  [/\bcalca\b/,                              'calca'],
  [/\bchinelo\b/,                            'chinelo'],
  [/oculos/,                                 'oculos'],
  [/\b(kit|combo)\b/,                        'kit'],
];

const SIZE_PATTERNS = [
  /\b(gg|pp|g|p|m)\b/,
  /\b(3[5-9]|4[0-9])\b/,
];

const COLOR_PATTERNS = [
  /\b(preta?|branca?|azul|vermelh[ao]|verde|amarela?|cinza|bege|vinho|navy|off.?white|laranja|rosa|roxo|lilas|caramelo|marrom|creme|nude)\b/,
];

const PRICE_PATTERN = /\bate\s*r?\$?\s*(\d+(?:[.,]\d{1,2})?)/;

export function detectProductQuery(message: string): BotProductSearchFilters | null {
  const norm = normalizeText(message);
  const filters: BotProductSearchFilters = {};

  for (const [re, cat] of CATEGORY_PATTERNS) {
    if (re.test(norm)) { filters.category = cat; break; }
  }

  for (const re of SIZE_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.size = normalizeSize(m[0]); break; }
  }

  for (const re of COLOR_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.color = m[0]; break; }
  }

  const priceMatch = norm.match(PRICE_PATTERN);
  if (priceMatch) {
    filters.maxPrice = parseFloat(priceMatch[1].replace(',', '.'));
  }

  const hasFilter = filters.category || filters.size || filters.color || filters.maxPrice;
  if (!hasFilter) return null;

  return filters;
}

// ─────────────────────────────────────────────────────────────────────────────
// logInventoryQuery — inclui storeId para rastreabilidade multi-tenant
// ─────────────────────────────────────────────────────────────────────────────
export function logInventoryQuery(
  storeId: string,
  phone: string,
  message: string,
  filters: BotProductSearchFilters | null,
  resultCount: number,
  botReply: string,
): void {
  console.log(
    `[Inventory][${storeId}] phone=${phone} | msg="${message.slice(0, 60)}" | ` +
    `filters=${JSON.stringify(filters)} | found=${resultCount} | ` +
    `reply="${botReply.slice(0, 80)}"`
  );
}
