/**
 * storeMindService — a "mente" do funcionário.
 *
 * Junta o que o bot precisa pra vender como gente: o CATÁLOGO com detalhe
 * (cor, tipo, preço, descrição enriquecida) e o PERFIL do lead no CRM.
 * Devolve isso como texto compacto pra injetar no prompt da IA.
 *
 * Lê o catálogo da loja: se for a loja do site (SITE_STORE_ID), usa o client
 * read-only do site (campos bot_description/search_tags/secondary_colors);
 * senão, usa o Supabase principal por store_id (campos description/tags).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface MindProduct {
  sku: string;
  name: string;
  category: string;
  subcategory: string;
  color: string;
  secondary: string[];
  type: string;
  desc: string;
  tags: string[];
  price: number;
  promo: number | null;
  featured: boolean;
  sizes: string[];
  image: string;
}

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

let _siteClient: SupabaseClient | null = null;
function siteClient(): SupabaseClient | null {
  if (_siteClient) return _siteClient;
  const url = process.env.SITE_SUPABASE_URL, key = process.env.SITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _siteClient = createClient(url, key);
  return _siteClient;
}
const isSiteStore = (storeId: string) => !!process.env.SITE_STORE_ID && storeId === process.env.SITE_STORE_ID;

const sizesOf = (sizes: unknown): string[] =>
  Array.isArray(sizes)
    ? sizes.map((s: unknown) => (typeof s === 'string' ? s : (s as { size?: string; stock?: number })?.size))
        .filter(Boolean).map(String)
    : [];

// ── Cache 5min do catálogo por loja ──────────────────────────────────────────
const _cat = new Map<string, { data: MindProduct[]; exp: number }>();

export async function getCatalogForMind(storeId: string): Promise<MindProduct[]> {
  const hit = _cat.get(storeId);
  if (hit && Date.now() < hit.exp) return hit.data;

  let rows: Record<string, unknown>[] = [];
  if (isSiteStore(storeId)) {
    const c = siteClient();
    if (c) {
      const { data } = await c.from('products')
        .select('sku,name,category,subcategory,color,secondary_colors,product_type,bot_description,search_tags,price,promotional_price,stock,sizes,featured,is_kit,image')
        .gt('stock', 0).limit(300);
      rows = (data || []).filter((r) => !r.is_kit);
    }
  } else {
    const { data } = await supabase.from('products')
      .select('sku,name,category,subcategory,color,product_type,description,tags,price,promotional_price,stock,sizes,featured,is_active,image_url')
      .eq('store_id', storeId).gt('stock', 0).limit(300);
    rows = (data || []).filter((r) => r.is_active !== false);
  }

  const mapped: MindProduct[] = rows.map((r) => ({
    sku: String(r.sku || ''),
    name: String(r.name || ''),
    category: String(r.category || ''),
    subcategory: String(r.subcategory || ''),
    color: String(r.color || ''),
    secondary: Array.isArray(r.secondary_colors) ? (r.secondary_colors as string[]) : [],
    type: String(r.product_type || ''),
    desc: String(r.bot_description || r.description || ''),
    tags: Array.isArray(r.search_tags) ? (r.search_tags as string[]) : (Array.isArray(r.tags) ? (r.tags as string[]) : []),
    price: Number(r.price) || 0,
    promo: r.promotional_price != null && Number(r.promotional_price) > 0 && Number(r.promotional_price) < Number(r.price) ? Number(r.promotional_price) : null,
    featured: !!r.featured,
    sizes: sizesOf(r.sizes),
    image: String(r.image || r.image_url || ''),
  }));

  _cat.set(storeId, { data: mapped, exp: Date.now() + 5 * 60 * 1000 });
  return mapped;
}

// ── Seleciona os produtos mais relevantes pra mensagem do cliente ─────────────
function scoreProduct(p: MindProduct, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hay = norm([p.name, p.category, p.subcategory, p.color, p.secondary.join(' '), p.type, p.tags.join(' '), p.desc].join(' '));
  let score = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (hay.includes(t)) score += 1;
    if (norm(p.category).includes(t) || norm(p.color) === t) score += 1; // reforça categoria/cor
  }
  return score;
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

function line(p: MindProduct): string {
  const cat = [p.category, p.subcategory].filter(Boolean).join('/');
  const cor = [p.color, ...p.secondary].filter(Boolean).join('+');
  const preco = p.promo ? `${brl(p.promo)} (de ${brl(p.price)})` : brl(p.price);
  const tam = p.sizes.length ? ` · tam ${p.sizes.slice(0, 6).join('/')}` : '';
  const d = p.desc ? ` — ${p.desc.slice(0, 90)}` : '';
  return `• ${p.name}${cat ? ` (${cat})` : ''}${cor ? ` · ${cor}` : ''} · ${preco}${tam}${d}`;
}

/**
 * Monta o trecho de catálogo pra IA: os produtos mais relevantes pra mensagem.
 * Sem match claro, devolve destaques/baratos como vitrine.
 */
export async function buildCatalogSnippet(storeId: string, message: string, max = 12): Promise<string> {
  const catalog = await getCatalogForMind(storeId);
  if (catalog.length === 0) return '';

  const tokens = norm(message).split(' ').filter((t) => t.length >= 3);
  const scored = catalog
    .map((p) => ({ p, s: scoreProduct(p, tokens) }))
    .sort((a, b) => b.s - a.s || (b.p.featured ? 1 : 0) - (a.p.featured ? 1 : 0) || a.p.price - b.p.price);

  const relevant = scored.filter((x) => x.s > 0).slice(0, max).map((x) => x.p);
  const list = relevant.length > 0
    ? relevant
    : catalog.filter((p) => p.featured).concat(catalog).slice(0, Math.min(8, max));

  const header = relevant.length > 0 ? 'Produtos que casam com o que o cliente falou:' : 'Alguns destaques da loja:';
  return `${header}\n${list.map(line).join('\n')}`;
}

// ── Perfil do lead (CRM) pra personalizar ─────────────────────────────────────
export async function buildLeadProfile(storeId: string, phone: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('bot_leads')
      .select('nome,status_comercial,interesse,total_purchases,lifetime_value,cidade,tamanho,context')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .maybeSingle();
    if (!data) return '';
    const parts: string[] = [];
    if (data.nome) parts.push(`Nome: ${data.nome}`);
    if (data.status_comercial) parts.push(`Calor: ${data.status_comercial}`);
    if (data.interesse) parts.push(`Interesse: ${data.interesse}`);
    if (data.cidade) parts.push(`Cidade: ${data.cidade}`);
    if (data.tamanho) parts.push(`Tamanho: ${data.tamanho}`);
    if (Number(data.total_purchases) > 0) parts.push(`Já comprou ${data.total_purchases}x (total ${brl(Number(data.lifetime_value) || 0)})`);
    // Memória de longo prazo: resumo de conversas anteriores (leadMemoryService)
    const memoria = (data.context as Record<string, unknown> | null)?.memoria;
    if (memoria && typeof memoria === 'string') parts.push(`Memória de conversas anteriores: ${memoria}`);
    return parts.length ? parts.join(' · ') : '';
  } catch {
    return '';
  }
}
