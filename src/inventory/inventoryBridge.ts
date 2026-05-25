/**
 * InventoryBridge — READ-ONLY bridge entre o bot e o catálogo do site.
 * Zero escrita: nenhum INSERT, UPDATE ou DELETE no Supabase do site.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BotProduct, BotProductSearchFilters, SiteProductRow } from './inventoryTypes';
import { mapMany, mapSiteProductToBotProduct } from './inventoryMapper';
import { normalizeText, normalizeSize } from './inventoryUtils';

// ── Cliente Supabase do site (anon key — somente leitura) ─────────────────────
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

// ── Mapa categoria → valor exato no banco (uppercase conforme DB) ─────────────
// Padrões testados contra texto NORMALIZADO (sem acento, minúsculo)
// DB: CAMISA | CALÇA | BERMUDA | CHINELO | KITS | ÓCULOS  | TÊNIS
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/\b(camis[ae]t?a?|polo|regata|blusa)\b/, 'CAMISA'],
  [/\btenis\b/,                              'TÊNIS'],
  [/\bbermuda\b/,                            'BERMUDA'],
  [/\bcalca\b/,                              'CALÇA'],
  [/\bchinelo\b/,                            'CHINELO'],
  [/oculos/,                                 'ÓCULOS '],  // trailing space como está no banco
  [/\b(kit|combo)\b/,                        'KITS'],
];

// Converte categoria digitada pelo cliente → valor exato do banco
// Normaliza a entrada antes de testar os padrões
function buildCategoryFilter(raw: string): string[] {
  const norm = normalizeText(raw);
  for (const [re, dbValue] of CATEGORY_MAP) {
    if (re.test(norm)) return [dbValue];
  }
  return [raw.trim().toUpperCase()];
}

// ── Query base ────────────────────────────────────────────────────────────────
function baseQuery(client: SupabaseClient) {
  return client
    .from('products')
    .select('id,sku,name,price,category,image,stock,sizes,featured,subcategory,is_kit')
    .gt('stock', 0)
    .order('featured', { ascending: false })
    .order('name');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. searchProducts — busca livre no nome do produto
// ─────────────────────────────────────────────────────────────────────────────
export async function searchProducts(query: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const { data, error } = await baseQuery(client)
    .ilike('name', `%${query}%`)
    .limit(10);

  if (error) {
    console.error('[InventoryBridge] searchProducts error:', error.message);
    return [];
  }
  return mapMany((data || []) as SiteProductRow[]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getProductsByCategory — busca por categoria (tolerante a variações)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsByCategory(category: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const terms = buildCategoryFilter(category);
  const { data, error } = await baseQuery(client)
    .in('category', terms)
    .limit(50);

  if (error) {
    console.error('[InventoryBridge] getProductsByCategory error:', error.message);
    return [];
  }
  return mapMany((data || []) as SiteProductRow[]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. getProductsBySize — produtos com esse tamanho em estoque
//    Filtragem em JS porque sizes é JSONB
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsBySize(size: string): Promise<BotProduct[]> {
  const client = getSiteClient();
  if (!client) return [];

  const { data, error } = await baseQuery(client).limit(200);

  if (error) {
    console.error('[InventoryBridge] getProductsBySize error:', error.message);
    return [];
  }

  const sz = normalizeSize(size);
  const filtered = ((data || []) as SiteProductRow[]).filter(row =>
    (row.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0)
  );

  return mapMany(filtered).slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getProductAvailability — verifica se produto específico tem estoque
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductAvailability(productId: string | number): Promise<BotProduct | null> {
  const client = getSiteClient();
  if (!client) return null;

  const { data, error } = await client
    .from('products')
    .select('id,sku,name,price,category,image,stock,sizes,featured,subcategory,is_kit')
    .eq('id', productId)
    .single();

  if (error || !data) {
    if (error?.code !== 'PGRST116') {
      console.error('[InventoryBridge] getProductAvailability error:', error?.message);
    }
    return null;
  }

  return mapSiteProductToBotProduct(data as SiteProductRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. getProductForBotContext — filtros combinados (principal)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductForBotContext(filters: BotProductSearchFilters): Promise<BotProduct[]> {
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
    console.error('[InventoryBridge] getProductForBotContext error:', error.message);
    return [];
  }

  let rows = (data || []) as SiteProductRow[];

  // Post-filtro por tamanho — normaliza ambos os lados para comparação segura
  if (filters.size) {
    const sz = normalizeSize(filters.size);
    rows = rows.filter(r =>
      (r.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0)
    );
  }

  // Post-filtro por cor — normaliza nome do produto e o filtro
  if (filters.color) {
    const cl = normalizeText(filters.color);
    rows = rows.filter(r => normalizeText(r.name).includes(cl));
  }

  return mapMany(rows).slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// Função principal — chamada pelo motor do bot
// ─────────────────────────────────────────────────────────────────────────────
export async function findProductsForBot(filters: BotProductSearchFilters): Promise<BotProduct[]> {
  const hasSpecific = filters.category || filters.size || filters.query || filters.color;
  if (!hasSpecific) return [];
  return getProductForBotContext(filters);
}

// ─────────────────────────────────────────────────────────────────────────────
// formatProductsResponse — monta a resposta do bot a partir da lista de produtos
// ─────────────────────────────────────────────────────────────────────────────

// Exibição com acentos para mensagens ao cliente
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
// Normaliza a mensagem antes de aplicar os padrões (case + acento insensitive)
// ─────────────────────────────────────────────────────────────────────────────

// Padrões de categoria — aplicados sobre texto normalizado (sem acento, minúsculo)
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(camis[ae]t?a?|polo|regata|blusa)\b/, 'camisa'],
  [/\btenis\b/,                              'tenis'],
  [/\bbermuda\b/,                            'bermuda'],
  [/\bcalca\b/,                              'calca'],
  [/\bchinelo\b/,                            'chinelo'],
  [/oculos/,                                 'oculos'],
  [/\b(kit|combo)\b/,                        'kit'],
];

// Padrões de tamanho — aplicados sobre texto normalizado (já minúsculo)
// normalizeSize() após extração garante retorno em MAIÚSCULO
const SIZE_PATTERNS = [
  /\b(gg|pp|g|p|m)\b/,       // letras — ordem: maior primeiro
  /\b(3[5-9]|4[0-9])\b/,     // numérico 35–49
];

// Padrões de cor — aplicados sobre texto normalizado (sem acento, minúsculo)
const COLOR_PATTERNS = [
  /\b(preta?|branca?|azul|vermelh[ao]|verde|amarela?|cinza|bege|vinho|navy|off.?white|laranja|rosa|roxo|lilas|caramelo|marrom|creme|nude)\b/,
];

// Padrão de preço máximo — "até 100", "ate R$120", "ate 99,90"
const PRICE_PATTERN = /\bate\s*r?\$?\s*(\d+(?:[.,]\d{1,2})?)/;

export function detectProductQuery(message: string): BotProductSearchFilters | null {
  // Normaliza a mensagem: "CAMISA BRANCA G" → "camisa branca g"
  const norm = normalizeText(message);
  const filters: BotProductSearchFilters = {};

  for (const [re, cat] of CATEGORY_PATTERNS) {
    if (re.test(norm)) { filters.category = cat; break; }
  }

  for (const re of SIZE_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.size = normalizeSize(m[0]); break; }  // "gg" → "GG", "42" → "42"
  }

  for (const re of COLOR_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.color = m[0]; break; }  // já em minúsculo/sem acento
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
// Logging
// ─────────────────────────────────────────────────────────────────────────────
export function logInventoryQuery(
  phone: string,
  message: string,
  filters: BotProductSearchFilters | null,
  resultCount: number,
  botReply: string,
): void {
  console.log(
    `[Inventory] phone=${phone} | msg="${message.slice(0, 60)}" | ` +
    `filters=${JSON.stringify(filters)} | found=${resultCount} | ` +
    `reply="${botReply.slice(0, 80)}"`
  );
}
