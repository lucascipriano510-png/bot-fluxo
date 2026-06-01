/**
 * InventoryBridge — READ-ONLY bridge entre o bot e o catálogo de produtos.
 * Zero escrita: nenhum INSERT, UPDATE ou DELETE.
 *
 * Arquitetura multi-tenant:
 * - Toda consulta recebe storeId para garantir isolamento entre lojas.
 * - SITE_SUPABASE_URL aponta para o catálogo externo da loja (read-only).
 * - Futuras lojas usarão o Supabase do próprio bot com store_id.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { BotProduct, BotProductSearchFilters, SiteProductRow } from './inventoryTypes';
import { mapMany, mapSiteProductToBotProduct } from './inventoryMapper';
import { normalizeText, normalizeSize } from './inventoryUtils';

// ── Cliente Supabase do catálogo externo (anon key — somente leitura) ────────
// Fonte de produtos via SITE_SUPABASE_URL. Quando a loja migrar para o painel
// SaaS com catálogo próprio, este cliente pode ser removido.
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

// ── Logging de queries Supabase ───────────────────────────────────────────────
function qlog(op: string, detail: Record<string, unknown>, cacheHit = false): void {
  const tag = cacheHit ? '📦 CACHE HIT' : '🔍 SUPABASE';
  console.log(`[InventoryBridge][${tag}] ${op} | ${JSON.stringify(detail)}`);
}

// ── Cache em memória — TTL 5 minutos ─────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) _cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T): void {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
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

// Identifica se uma loja usa o catálogo externo (ex: Fluxo Outlet via SITE_SUPABASE_URL).
// Todas as outras lojas buscam produtos no Supabase principal filtrado por store_id.
function isSiteStore(storeId: string): boolean {
  const siteStoreId = process.env.SITE_STORE_ID;
  return !!siteStoreId && storeId === siteStoreId;
}

// ── Query select strings ──────────────────────────────────────────────────────
// Site client (Fluxo Outlet — external, may not have migration 9 columns)
const BOT_SELECT = 'id,sku,name,price,category,subcategory,stock,sizes,featured';

// Main Supabase (bot's own DB — has all universal catalog fields after migration 9)
const BOT_SELECT_FULL = 'id,sku,name,price,category,subcategory,stock,sizes,featured,is_active,item_type,description,price_type,bot_instructions,tags,image_url';

function baseQuery(client: SupabaseClient) {
  return client
    .from('products')
    .select(BOT_SELECT)
    .gt('stock', 0)
    .order('featured', { ascending: false })
    .order('name');
}

// Availability per item_type: physical requires stock > 0; others require is_active
function isAvailable(row: SiteProductRow): boolean {
  if (!row.item_type || row.item_type === 'produto_fisico') return row.stock > 0;
  return row.is_active !== false;
}

// Query base para o Supabase principal — filtra por store_id, sem filtro de estoque no DB
// (estoque é filtrado em JS via isAvailable para suportar serviços/combos/orçamentos)
function baseQueryMain(storeId: string) {
  return supabase
    .from('products')
    .select(BOT_SELECT_FULL)
    .eq('store_id', storeId)
    .order('featured', { ascending: false })
    .order('name');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. searchProducts — busca livre no nome
// ─────────────────────────────────────────────────────────────────────────────
export async function searchProducts(storeId: string, query: string): Promise<BotProduct[]> {
  qlog('searchProducts', { storeId, query });

  if (!isSiteStore(storeId)) {
    const { data, error } = await baseQueryMain(storeId)
      .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
      .limit(10);
    if (error) { console.error(`[InventoryBridge][${storeId}] searchProducts error:`, error.message); return []; }
    return mapMany(((data || []) as SiteProductRow[]).filter(isAvailable), storeId);
  }

  const client = getSiteClient();
  if (!client) return [];
  const { data, error } = await baseQuery(client).ilike('name', `%${query}%`).limit(10);
  if (error) { console.error(`[InventoryBridge][${storeId}] searchProducts error:`, error.message); return []; }
  return mapMany((data || []) as SiteProductRow[], storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getProductsByCategory — busca por categoria
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsByCategory(storeId: string, category: string): Promise<BotProduct[]> {
  const terms = await buildDynamicCategoryFilter(storeId, category);
  qlog('getProductsByCategory', { storeId, category, terms });

  if (!isSiteStore(storeId)) {
    const { data, error } = await baseQueryMain(storeId).in('category', terms).limit(50);
    if (error) { console.error(`[InventoryBridge][${storeId}] getProductsByCategory error:`, error.message); return []; }
    return mapMany(((data || []) as SiteProductRow[]).filter(isAvailable), storeId);
  }

  const client = getSiteClient();
  if (!client) return [];
  const { data, error } = await baseQuery(client).in('category', terms).limit(50);
  if (error) { console.error(`[InventoryBridge][${storeId}] getProductsByCategory error:`, error.message); return []; }
  return mapMany((data || []) as SiteProductRow[], storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. getProductsBySize — produtos com tamanho em estoque (filtro em JS, JSONB)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductsBySize(storeId: string, size: string): Promise<BotProduct[]> {
  qlog('getProductsBySize', { storeId, size });

  let rows: SiteProductRow[];

  if (!isSiteStore(storeId)) {
    const { data, error } = await baseQueryMain(storeId).limit(200);
    if (error) { console.error(`[InventoryBridge][${storeId}] getProductsBySize error:`, error.message); return []; }
    rows = ((data || []) as SiteProductRow[]).filter(isAvailable);
  } else {
    const client = getSiteClient();
    if (!client) return [];
    const { data, error } = await baseQuery(client).limit(200);
    if (error) { console.error(`[InventoryBridge][${storeId}] getProductsBySize error:`, error.message); return []; }
    rows = (data || []) as SiteProductRow[];
  }

  const sz = normalizeSize(size);
  const filtered = rows.filter(row =>
    (row.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0)
  );
  return mapMany(filtered, storeId).slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getProductAvailability — verifica disponibilidade de produto específico
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductAvailability(storeId: string, productId: string | number): Promise<BotProduct | null> {
  qlog('getProductAvailability', { storeId, productId });

  const client = isSiteStore(storeId) ? getSiteClient() : supabase;
  if (!client) return null;

  // Não usar .single() — kit no site client pode ter view que expande para múltiplas linhas
  const q = isSiteStore(storeId)
    ? (client as SupabaseClient).from('products').select(BOT_SELECT).eq('id', productId).limit(1)
    : supabase.from('products').select(BOT_SELECT).eq('store_id', storeId).eq('id', productId).limit(1);

  const { data: rows, error } = await q;
  const data = Array.isArray(rows) ? rows[0] : null;
  if (error || !data) {
    if (error && (error as unknown as Record<string,unknown>).code !== 'PGRST116') {
      console.error(`[InventoryBridge][${storeId}] getProductAvailability error:`, (error as unknown as Record<string,unknown>).message ?? error);
    }
    return null;
  }
  return mapSiteProductToBotProduct(data as SiteProductRow, storeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. getProductForBotContext — filtros combinados (função central)
// ─────────────────────────────────────────────────────────────────────────────
export async function getProductForBotContext(storeId: string, filters: BotProductSearchFilters): Promise<BotProduct[]> {
  const correctedSub = filters.subcategory
    ? await fuzzyCorrectBrand(storeId, filters.subcategory)
    : undefined;

  const cacheKey = `bot:${storeId}:cat=${filters.category || ''}:sub=${correctedSub || ''}:sz=${filters.size || ''}:cl=${filters.color || ''}:px=${filters.maxPrice || ''}:q=${filters.query || ''}`;
  const cached = cacheGet<BotProduct[]>(cacheKey);
  if (cached) {
    qlog('getProductForBotContext', { storeId, filters, correctedSub, results: cached.length }, true);
    return cached;
  }

  qlog('getProductForBotContext', { storeId, filters, correctedSub });

  let rows: SiteProductRow[];

  if (isSiteStore(storeId)) {
    const client = getSiteClient();
    if (!client) return [];

    let q = client.from('products').select(BOT_SELECT).gt('stock', 0).order('featured', { ascending: false });
    if (filters.query)        q = q.ilike('name', `%${filters.query}%`);
    if (filters.category) {
      const catTerms = await buildDynamicCategoryFilter(storeId, filters.category);
      q = q.in('category', catTerms);
    }
    if (correctedSub)         q = q.or(`subcategory.ilike.%${correctedSub}%,name.ilike.%${correctedSub}%`);
    if (filters.maxPrice)     q = q.lte('price', filters.maxPrice);
    if (filters.featuredOnly) q = q.eq('featured', true);

    const { data, error } = await q.limit(100);
    if (error) { console.error(`[InventoryBridge][${storeId}] getProductForBotContext error:`, error.message); return []; }
    rows = (data || []) as SiteProductRow[];

  } else {
    let q = supabase.from('products').select(BOT_SELECT_FULL).eq('store_id', storeId).order('featured', { ascending: false });
    if (filters.query)        q = q.or(`name.ilike.%${filters.query}%,description.ilike.%${filters.query}%`);
    if (filters.category) {
      const catTerms = await buildDynamicCategoryFilter(storeId, filters.category);
      q = q.in('category', catTerms);
    }
    if (correctedSub)         q = q.or(`subcategory.ilike.%${correctedSub}%,name.ilike.%${correctedSub}%`);
    if (filters.maxPrice)     q = q.lte('price', filters.maxPrice);
    if (filters.featuredOnly) q = q.eq('featured', true);

    const { data, error } = await q.limit(100);
    if (error) { console.error(`[InventoryBridge][${storeId}] getProductForBotContext error:`, error.message); return []; }
    rows = ((data || []) as SiteProductRow[]).filter(isAvailable);
  }

  if (filters.size) {
    const sz = normalizeSize(filters.size);
    rows = rows.filter(r => (r.sizes || []).some(s => normalizeSize(s.size) === sz && s.stock > 0));
  }

  if (filters.color) {
    const variants = expandColor(filters.color);
    rows = rows.filter(r => variants.some(v => normalizeText(r.name).includes(v)));
  }

  const result = mapMany(rows, storeId).slice(0, 20);
  cacheSet(cacheKey, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// findProductsForBot — função principal chamada pelo motor do bot
// Garante que NENHUMA consulta de produto ocorre sem contexto de loja (storeId)
// ─────────────────────────────────────────────────────────────────────────────
export async function findProductsForBot(storeId: string, filters: BotProductSearchFilters): Promise<BotProduct[]> {
  const hasSpecific = filters.category || filters.size || filters.query || filters.color || filters.subcategory;
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
    return 'Não encontrei esse item no catálogo agora. Me fala mais o que você precisa que eu te ajudo.';
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
    if (p.includedItems) msg += `📦 Inclui: ${p.includedItems}\n`;
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
  /\b(pret[ao]|branc[ao]|azul|vermelh[ao]|verde|amarelo|amarela|cinza|bege|vinho|navy|off.?white|laranja|rosa|roxo|roxo|lilas|caramelo|marrom|creme|nude|black|white|gray|grey)\b/,
];

// Variantes de cor: mapeia qualquer forma para as variantes que podem estar no banco
const COLOR_EXPAND: Record<string, string[]> = {
  preto:    ['preto','preta','black'],
  preta:    ['preto','preta','black'],
  black:    ['preto','preta','black'],
  branco:   ['branco','branca','white'],
  branca:   ['branco','branca','white'],
  white:    ['branco','branca','white'],
  vermelho: ['vermelho','vermelha','red'],
  vermelha: ['vermelho','vermelha','red'],
  amarelo:  ['amarelo','amarela'],
  amarela:  ['amarelo','amarela'],
  roxo:     ['roxo','roxa'],
  roxa:     ['roxo','roxa'],
  gray:     ['cinza','gray','grey'],
  grey:     ['cinza','gray','grey'],
};

function expandColor(color: string): string[] {
  const c = normalizeText(color);
  return COLOR_EXPAND[c] ?? [c];
}

// ── Levenshtein — distância de edição entre duas strings ──────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

// ── Marcas conhecidas — carrega subcategorias únicas do banco (cache 5 min) ───
async function loadKnownBrands(storeId: string): Promise<string[]> {
  const KEY = `meta:brands:${storeId}`;
  const cached = cacheGet<string[]>(KEY);
  if (cached) return cached;

  let data: Array<Record<string, unknown>> | null = null;
  if (isSiteStore(storeId)) {
    const client = getSiteClient();
    if (!client) return [];
    const res = await client.from('products').select('subcategory');
    data = res.data;
  } else {
    const res = await supabase.from('products').select('subcategory').eq('store_id', storeId);
    data = res.data;
  }

  const brands = [
    ...new Set(
      (data || [])
        .map(r => r.subcategory as string)
        .filter(Boolean)
        .map(s => normalizeText(s)),
    ),
  ];
  cacheSet(KEY, brands);
  return brands;
}

// ── Fuzzy correction — corrige typos de marca contra o catálogo real ──────────
async function fuzzyCorrectBrand(storeId: string, input: string): Promise<string> {
  const norm = normalizeText(input);
  // Threshold proporcional: curtas (≤4) e médias (5-6) aceitam 1 erro;
  // longas (≥7) não fazem fuzzy — marcas como "lacoste" são específicas demais.
  const threshold = norm.length <= 4 ? 1 : norm.length <= 6 ? 1 : 0;
  if (threshold === 0) {
    console.log(`[InventoryBridge] fuzzy brand: "${norm}" — palavra longa, sem correção fuzzy`);
    return norm;
  }
  const brands = await loadKnownBrands(storeId);
  let best = norm, bestDist = threshold + 1;
  for (const brand of brands) {
    const d = levenshtein(norm, brand);
    if (d < bestDist) { best = brand; bestDist = d; }
  }
  if (bestDist <= threshold && best !== norm) {
    console.log(`[InventoryBridge] fuzzy brand: "${norm}" → "${best}" (dist=${bestDist})`);
  }
  return best;
}

// ── Categorias reais da loja — carregadas do banco, cacheadas 5 min ──────────
export async function loadStoreCategories(storeId: string): Promise<string[]> {
  const KEY = `meta:categories:${storeId}`;
  const cached = cacheGet<string[]>(KEY);
  if (cached) return cached;

  let data: Array<Record<string, unknown>> | null = null;
  if (isSiteStore(storeId)) {
    const client = getSiteClient();
    if (!client) return [];
    const res = await client.from('products').select('category');
    data = res.data;
  } else {
    const res = await supabase
      .from('products')
      .select('category')
      .eq('store_id', storeId)
      .eq('is_active', true);
    data = res.data;
  }

  const categories = [
    ...new Set(
      (data || [])
        .map(r => r.category as string)
        .filter(Boolean)
        .map(c => c.trim()),
    ),
  ];
  cacheSet(KEY, categories);
  return categories;
}

// ── Tags únicas da loja — vocabulário expandido para detecção ────────────────
async function loadStoreTags(storeId: string): Promise<string[]> {
  const KEY = `meta:tags:${storeId}`;
  const cached = cacheGet<string[]>(KEY);
  if (cached) return cached;

  let data: Array<Record<string, unknown>> | null = null;
  if (isSiteStore(storeId)) {
    const client = getSiteClient();
    if (!client) return [];
    const res = await client.from('products').select('tags').limit(500);
    data = res.data;
  } else {
    const res = await supabase
      .from('products')
      .select('tags')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .limit(500);
    data = res.data;
  }

  const allTags = (data || [])
    .flatMap(r => (Array.isArray(r.tags) ? r.tags as string[] : []))
    .filter(Boolean)
    .map(t => normalizeText(t));

  const unique = [...new Set(allTags)];
  cacheSet(KEY, unique);
  return unique;
}

// ── Filtro de categoria dinâmico — usa categorias reais do banco ──────────────
async function buildDynamicCategoryFilter(storeId: string, rawText: string): Promise<string[]> {
  if (isSiteStore(storeId)) {
    return buildCategoryFilter(rawText);
  }

  const norm = normalizeText(rawText);
  const categories = await loadStoreCategories(storeId);

  const directMatch = categories.find(c => normalizeText(c) === norm);
  if (directMatch) return [directMatch];

  const partialMatches = categories.filter(c => {
    const normCat = normalizeText(c);
    return normCat.includes(norm) || norm.includes(normCat);
  });
  if (partialMatches.length > 0) return partialMatches;

  return [rawText.trim().toUpperCase()];
}

const PRICE_PATTERN = /\bate\s*r?\$?\s*(\d+(?:[.,]\d{1,2})?)/;

// Palavras PT que não são marcas nem categorias — usadas para extrair a marca residual
const PT_STOP = new Set([
  // verbos comuns antes de pedidos
  'tem','ha','voce','vc','eu','quero','queria','querendo','queria',
  'preciso','precisaria','precisando','gostaria','gosto','poderia',
  'procuro','procurando','busco','buscando','comprar','compraria',
  'pegar','pegaria','usar','usaria','manda','mande','manda','mostra',
  'teria','tivesse','tenho','tinha','ter','achar','buscar',
  'ver','mostrar','achei','vi',
  // preposições / artigos / pronomes
  'de','da','do','dos','das','um','uma','uns','umas',
  'para','pra','por','pelo','pela','pros','pras',
  'que','com','em','na','no','nas','nos','se',
  'isso','esse','essa','aquele','aquela','este','esta',
  'minha','meu','sua','seu','seus','suas',
  // negação / afirmação / questão
  'nao','sim','existe','algum','alguma',
  'tipo','modelo','me','disponiveis','disponivel','foto','fotos',
  'opcoes','opcao','ai','la','e','a','o','as','os',
  'mais','menos','so','tambem','ainda','ja',
  'como','onde','qual','quais','quanto','quanta',
  'ate','aqui','ali','bem','muito','pouco',
  'novo','nova','bom','boa','top','legal','certo','certa',
  // Termos de preço e pagamento — nunca são nomes de produto
  'valor','preco','custa','custo','pagar','pagamento',
  'forma','formas','parcelar','parcela','desconto','promocao','oferta',
  'barato','caro','salgado',
  // Termos de entrega
  'entrega','frete','envio','enviar','prazo','correios','motoboy',
  'entregar','receber','chegou','chegar',
  // Termos de troca / pós-venda
  'troca','trocar','devolver','devolucao','garantia','defeito',
  // Termos de contato / loja
  'site','instagram','whatsapp','zap','contato','atendente','vendedor',
  'loja','horario','horarios','aberto','fecha','abre','funciona',
  // Termos de catálogo / visual
  'catalogo','imagem','imagens','link',
  // Qualificadores genéricos
  'melhor','bonito','bonita',
]);

export async function detectProductQuery(
  message: string,
  storeId?: string,
): Promise<BotProductSearchFilters | null> {
  // ── GUARDA: perguntas puramente comerciais — nunca são produto ────────────
  const COMMERCIAL_ONLY = [
    /^qual [ée] o (valor|pre[çc]o|site|instagram|whatsapp)[^?]*\?*$/i,
    /^quanto (custa|[ée]|fica|ta|tá)[^?]*\?*$/i,
    /^(tem|qual|como)[^?]*(desconto|promo[çc][aã]o|oferta|frete|entrega)[^?]*\?*$/i,
    /^(qual|manda|me passa)[^?]*(site|instagram|link|contato|numero|telefone)[^?]*\?*$/i,
  ];
  for (const re of COMMERCIAL_ONLY) {
    if (re.test(message.trim())) return null;
  }

  const norm = normalizeText(message);
  const filters: BotProductSearchFilters = {};

  // ── CAMADA 1: Tamanho ─────────────────────────────────────────────────────
  for (const re of SIZE_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.size = normalizeSize(m[0]); break; }
  }

  // ── CAMADA 2: Cor ─────────────────────────────────────────────────────────
  for (const re of COLOR_PATTERNS) {
    const m = norm.match(re);
    if (m) { filters.color = m[0]; break; }
  }

  // ── CAMADA 3: Preço máximo ────────────────────────────────────────────────
  const priceMatch = norm.match(PRICE_PATTERN);
  if (priceMatch) {
    filters.maxPrice = parseFloat(priceMatch[1].replace(',', '.'));
  }

  // ── CAMADA 4: Categoria — dinâmica se storeId disponível, regex se não ────
  let detectedCategory: string | undefined;

  if (storeId) {
    const storeCategories = await loadStoreCategories(storeId);
    for (const cat of storeCategories) {
      const normCat = normalizeText(cat);
      const re = new RegExp(`\\b${normCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(norm)) { detectedCategory = cat; break; }
    }

    if (!detectedCategory) {
      const storeTags = await loadStoreTags(storeId);
      const words = norm.split(/\s+/).filter(w => w.length >= 3);
      const matchedTag = words.find(w => storeTags.includes(w));
      if (matchedTag) filters.query = matchedTag;
    }
  }

  if (!detectedCategory) {
    for (const [re, cat] of CATEGORY_PATTERNS) {
      if (re.test(norm)) { detectedCategory = cat; break; }
    }
  }

  if (detectedCategory) {
    filters.category = normalizeText(detectedCategory);
  }

  // ── CAMADA 5: Subcategoria/marca ──────────────────────────────────────────
  const hasStructuralFilter = filters.category || filters.size || filters.color || filters.maxPrice;

  if (hasStructuralFilter) {
    let residual = norm;
    if (detectedCategory) {
      const normCat = normalizeText(detectedCategory);
      residual = residual.replace(new RegExp(`\\b${normCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
    }
    for (const [re] of CATEGORY_PATTERNS) residual = residual.replace(re, ' ');
    for (const re of SIZE_PATTERNS)       residual = residual.replace(re, ' ');
    for (const re of COLOR_PATTERNS)      residual = residual.replace(re, ' ');
    residual = residual.replace(PRICE_PATTERN, ' ');

    const brandWords = residual
      .split(/\W+/)
      .filter(w => w.length >= 3 && !PT_STOP.has(w));

    if (brandWords.length > 0) {
      filters.subcategory = brandWords[brandWords.length - 1];
    }

    return filters;
  }

  // ── CAMADA 6: Busca livre ─────────────────────────────────────────────────
  const COMMERCIAL_TERMS = new Set([
    'valor','preco','custa','custo','quanto','pagar','pagamento',
    'forma','formas','parcelar','parcela','desconto','promocao','oferta',
    'barato','caro','salgado','entrega','frete','envio','enviar','prazo',
    'correios','motoboy','entregar','receber','chegou','chegar','troca',
    'trocar','devolver','devolucao','garantia','defeito','site','instagram',
    'whatsapp','zap','contato','atendente','vendedor','loja','horario',
    'horarios','aberto','fecha','abre','funciona','catalogo','foto','fotos',
    'imagem','imagens','ver','mostra','manda','link',
  ]);

  const meaningfulWords = norm
    .split(/\s+/)
    .filter(w => w.length >= 4 && !PT_STOP.has(w) && !COMMERCIAL_TERMS.has(w));

  if (meaningfulWords.length >= 1) {
    return { query: message.trim() };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchProductsForPanel — leitura completa para o painel visual
// Sem filtro de stock>0 para mostrar também produtos sem estoque no painel
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchProductsForPanel(storeId: string, filters?: {
  category?: string;
  q?: string;
}): Promise<SiteProductRow[]> {
  const cacheKey = `panel:${storeId}:cat=${filters?.category || ''}:q=${filters?.q || ''}`;
  const cached = cacheGet<SiteProductRow[]>(cacheKey);
  if (cached) {
    qlog('fetchProductsForPanel', { storeId, filters, results: cached.length }, true);
    return cached;
  }

  qlog('fetchProductsForPanel', { storeId, filters });

  // Site client uses legacy select (may not have migration 9 columns)
  const PANEL_SELECT      = 'id,sku,name,price,category,subcategory,image,stock,sizes,featured';
  // Main Supabase uses full select (after migration 9)
  const PANEL_SELECT_FULL = 'id,sku,name,price,promotional_price,category,subcategory,image,image_url,stock,sizes,featured,is_active,color,product_type,item_type,description,price_type,bot_instructions,tags,qualification_questions';

  let data: unknown[] | null = null;
  let errorMsg: string | null = null;

  if (isSiteStore(storeId)) {
    const client = getSiteClient();
    if (!client) return [];

    let q = client.from('products').select(PANEL_SELECT).order('featured', { ascending: false }).order('category').order('name').limit(500);
    if (filters?.category) q = q.eq('category', filters.category);
    if (filters?.q)        q = q.or(`name.ilike.%${filters.q}%,subcategory.ilike.%${filters.q}%`);

    const res = await q;
    data = res.data;
    errorMsg = res.error?.message ?? null;
  } else {
    let q = supabase.from('products').select(PANEL_SELECT_FULL).eq('store_id', storeId).order('featured', { ascending: false }).order('category').order('name').limit(500);
    if (filters?.category) q = q.eq('category', filters.category);
    if (filters?.q)        q = q.or(`name.ilike.%${filters.q}%,subcategory.ilike.%${filters.q}%,description.ilike.%${filters.q}%`);

    const res = await q;
    data = res.data;
    errorMsg = res.error?.message ?? null;
  }

  if (errorMsg) {
    console.error(`[InventoryBridge][${storeId}] fetchProductsForPanel error:`, errorMsg);
    return [];
  }

  const result = (data || []) as SiteProductRow[];
  cacheSet(cacheKey, result);
  return result;
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
