/**
 * CatalogBridge — Camada de abstração multi-segmento para SaaS.
 *
 * ─── ARQUITETURA ────────────────────────────────────────────────────────────
 *
 *  Bot Engine
 *      │
 *      ▼
 *  CatalogBridge.findOffers(filters)          ← ponto único de entrada
 *      │
 *      ├── businessId = 'fluxo-outlet'  →  InventoryBridge (catálogo do site)
 *      │                                   mapeia BotProduct → BusinessOffer
 *      │
 *      ├── businessId = 'lava-jato-x'   →  (futuro) SaaSAdapter
 *      │                                   lê business_offers WHERE business_id
 *      │
 *      └── businessId = 'barbearia-y'   →  (futuro) SaaSAdapter
 *                                          lê business_offers WHERE business_id
 *
 * ─── POR QUE ISSO RESOLVE O PROBLEMA ───────────────────────────────────────
 *
 *  Loja de roupa (atual):
 *    Cliente: "tem camisa branca G?"
 *    filters.attributes = { color: 'branca', sizes: 'G' }
 *    offerType = 'physical_product'
 *
 *  Lava-jato (futuro):
 *    Cliente: "quanto é lavagem completa pra SUV?"
 *    filters.attributes = { vehicleType: 'SUV', serviceLevel: 'completa' }
 *    offerType = 'service'
 *
 *  Barbearia (futuro):
 *    Cliente: "tem horário amanhã de manhã?"
 *    filters.offerType = 'appointment'
 *    filters.attributes = { period: 'manha' }
 *
 *  O motor do bot chama sempre o mesmo CatalogBridge.
 *  A diferença está em: qual businessId + quais attributes.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { BusinessOffer, OfferSearchFilters } from './offerTypes';
import { manyToOffers } from './offerMapper';
import {
  findProductsForBot,
} from '../inventory/inventoryBridge';
import { BotProductSearchFilters } from '../inventory/inventoryTypes';

const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

// Mapeia categoria normalizada → valor que o site espera na URL
const CAT_TO_URL: Record<string, string> = {
  camisa:   'CAMISA',
  calca:    'CALÇA',
  bermuda:  'BERMUDA',
  chinelo:  'CHINELO',
  tenis:    'TÊNIS',
  oculos:   'ÓCULOS',
  kit:      'KITS',
};

export function buildCatalogUrl(filters: OfferSearchFilters): string | undefined {
  if (!SITE_URL || !filters.category) return undefined;

  const params = new URLSearchParams();
  params.set('categoria', CAT_TO_URL[filters.category] ?? filters.category.toUpperCase());

  if (filters.subcategory) params.set('sub', filters.subcategory.toUpperCase());

  const size  = filters.attributes?.size  ? String(filters.attributes.size)  : undefined;
  const color = filters.attributes?.color ? String(filters.attributes.color) : undefined;
  if (size)  params.set('tamanho', size.toUpperCase());
  if (color) params.set('cor',     color.toUpperCase());

  return `${SITE_URL}/?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// filtersToInventoryFilters
// Traduz OfferSearchFilters → BotProductSearchFilters para o adapter atual
// ─────────────────────────────────────────────────────────────────────────────
export function filtersToInventoryFilters(filters: OfferSearchFilters): BotProductSearchFilters {
  const inv: BotProductSearchFilters = {};

  if (filters.query)       inv.query       = filters.query;
  if (filters.category)    inv.category    = filters.category;
  if (filters.subcategory) inv.subcategory = filters.subcategory;
  if (filters.maxPrice)    inv.maxPrice    = filters.maxPrice;
  if (filters.onlyActive)  inv.featuredOnly = false;

  const attrs = filters.attributes || {};
  if (attrs.size)  inv.size  = String(attrs.size);
  if (attrs.color) inv.color = String(attrs.color);

  return inv;
}

// ─────────────────────────────────────────────────────────────────────────────
// findOffers — query única (uso interno + manter compat.)
// ─────────────────────────────────────────────────────────────────────────────
export async function findOffers(filters: OfferSearchFilters): Promise<BusinessOffer[]> {
  const inventoryFilters = filtersToInventoryFilters(filters);
  const hasFilter = inventoryFilters.category || inventoryFilters.size
    || inventoryFilters.query || inventoryFilters.color || inventoryFilters.subcategory;

  if (!hasFilter) return [];

  const products = await findProductsForBot(filters.businessId, inventoryFilters);
  return manyToOffers(products);
}

// ─────────────────────────────────────────────────────────────────────────────
// findOffersWithFallback — busca hierárquica em camadas
//
//  Tenta combinações de filtros do mais específico ao mais amplo,
//  parando na primeira camada que retornar resultados.
//
//  Ordem das camadas:
//   1. categoria + marca + cor + tamanho   (tudo)
//   2. categoria + marca + tamanho         (sem cor)
//   3. categoria + marca + cor             (sem tamanho)
//   4. categoria + marca                   (só marca)
//   5. categoria + tamanho                 (sem marca e cor)
//   6. categoria                           (mais amplo)
// ─────────────────────────────────────────────────────────────────────────────

interface FallbackLevel {
  f: OfferSearchFilters;
  dropped: string[];  // o que foi removido vs. query original
}

function buildFallbackLevels(base: OfferSearchFilters): FallbackLevel[] {
  const size  = base.attributes?.size  ? String(base.attributes.size)  : undefined;
  const color = base.attributes?.color ? String(base.attributes.color) : undefined;
  const sub   = base.subcategory;

  const make = (
    subcat: string | undefined,
    sz: string | undefined,
    cl: string | undefined,
    dropped: string[],
  ): FallbackLevel => {
    const attrs: Record<string, unknown> = {};
    if (sz) attrs.size  = sz;
    if (cl) attrs.color = cl;
    return {
      f: {
        ...base,
        subcategory: subcat,
        attributes:  Object.keys(attrs).length ? attrs : undefined,
      },
      dropped,
    };
  };

  const levels: FallbackLevel[] = [];

  // 1. Tudo
  levels.push(make(sub, size, color, []));

  // 2. Sem cor
  if (color) {
    levels.push(make(sub, size, undefined, ['cor']));
  }

  // 3. Sem tamanho
  if (size) {
    levels.push(make(sub, undefined, color, ['tamanho']));
  }

  // 4. Sem cor e sem tamanho
  if (color && size) {
    levels.push(make(sub, undefined, undefined, ['cor', 'tamanho']));
  }

  // 5. Sem marca (mantém tamanho se tiver)
  if (sub) {
    const dropped: string[] = [sub];
    if (color) dropped.push('cor');
    levels.push(make(undefined, size, undefined, dropped));
  }

  // 6. Só categoria
  if (sub || color || size) {
    const dropped: string[] = [];
    if (sub)   dropped.push(sub);
    if (size)  dropped.push('tamanho');
    if (color) dropped.push('cor');
    levels.push({
      f: { businessId: base.businessId, category: base.category, onlyActive: true },
      dropped,
    });
  }

  // Remove camadas duplicadas (mesmos filtros efetivos)
  const seen = new Set<string>();
  return levels.filter(({ f }) => {
    const key = [
      f.category ?? '',
      f.subcategory ?? '',
      f.attributes?.size ?? '',
      f.attributes?.color ?? '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface FallbackResult {
  offers:   BusinessOffer[];
  matched:  OfferSearchFilters;
  dropped:  string[];
}

export async function findOffersWithFallback(filters: OfferSearchFilters): Promise<FallbackResult> {
  const levels = buildFallbackLevels(filters);

  for (const { f, dropped } of levels) {
    const offers = await findOffers(f);
    if (offers.length > 0) {
      return { offers, matched: f, dropped };
    }
  }

  return { offers: [], matched: filters, dropped: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// formatOffersResponse — formata a resposta do bot a partir de BusinessOffers
// Agnóstico ao segmento: usa os dados da offer sem assumir produto físico
// ─────────────────────────────────────────────────────────────────────────────

const CAT_DISPLAY: Record<string, string> = {
  camisa: 'camisa', tenis: 'tênis', calca: 'calça',
  bermuda: 'bermuda', chinelo: 'chinelo', oculos: 'óculos', kit: 'kit',
};

export function formatOffersResponse(
  offers: BusinessOffer[],
  filters: OfferSearchFilters,
): string {
  if (offers.length === 0) {
    return 'Não encontrei esse modelo disponível agora. Quer que eu veja opções parecidas?';
  }

  const catDisplay  = filters.category
    ? (CAT_DISPLAY[filters.category] || filters.category)
    : null;
  const size        = filters.attributes?.size  ? String(filters.attributes.size)  : undefined;
  const color       = filters.attributes?.color ? String(filters.attributes.color) : undefined;
  const subcategory = filters.subcategory;

  const fmtPrice = (p?: number | null) =>
    p != null ? `R$${p.toFixed(2).replace('.', ',')}` : null;

  // Formata um produto individual com link
  const fmtOffer = (o: BusinessOffer, showSizes = false): string => {
    const priceStr = fmtPrice(o.price);
    const sizes    = (o.attributes?.sizes as string[] | undefined) || [];
    let line = `*${o.name}*`;
    if (priceStr) line += ` — ${priceStr}`;
    if (showSizes && sizes.length) line += `\n📏 Tamanhos: ${sizes.join(', ')}`;
    if (o.productUrl) line += `\n🔗 ${o.productUrl}`;
    return line;
  };

  if (offers.length === 1) {
    return fmtOffer(offers[0], true);
  }

  // Múltiplos resultados — usa subcategoria real do banco pra montar a URL
  const actualSub  = offers[0]?.subcategory ?? filters.subcategory;
  const catalogUrl = buildCatalogUrl({ ...filters, subcategory: actualSub });
  const urlLine    = catalogUrl ? `\n\n🔗 ${catalogUrl}` : '';

  if (catDisplay && size) {
    const brandPart = subcategory ? ` *${subcategory}*` : '';
    return `Tenho opções em *${catDisplay}*${brandPart} no tamanho *${size}*. Veja tudo aqui:${urlLine}`;
  }

  if (catDisplay || color || subcategory) {
    let line = '';
    if (catDisplay && subcategory) line = `em *${catDisplay}* da *${subcategory}*`;
    else if (catDisplay)           line = `em *${catDisplay}*`;
    else if (subcategory)          line = `da marca *${subcategory}*`;
    else                           line = `na cor *${color}*`;

    return `Tenho opções ${line}. Qual tamanho você usa?${urlLine}`;
  }

  return `Encontrei ${offers.length} opção(ões) pra você:${urlLine}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// formatFallbackResponse — versão inteligente do formatOffersResponse
// Quando filtros foram relaxados, informa o cliente o que não foi encontrado
// e mostra o que há disponível
// ─────────────────────────────────────────────────────────────────────────────
export function formatFallbackResponse(
  offers:   BusinessOffer[],
  original: OfferSearchFilters,
  matched:  OfferSearchFilters,
  dropped:  string[],
): string {
  // Sem resultado em nenhuma camada
  if (offers.length === 0) {
    const sub        = original.subcategory;
    const catDisplay = original.category ? (CAT_DISPLAY[original.category] || original.category) : null;
    const color      = original.attributes?.color ? String(original.attributes.color) : null;

    if (sub && catDisplay)  return `Não encontrei *${sub}* em *${catDisplay}* disponível agora. Quer ver outras opções?`;
    if (sub && color)       return `Não encontrei *${sub}* na cor *${color}* disponível agora. Quer ver outras opções?`;
    if (sub)                return `Não encontrei *${sub}* disponível agora. Quer ver outras opções?`;
    if (catDisplay)         return `Não encontrei nada em *${catDisplay}* com esses filtros. Quer ver outras opções?`;
    return `Não encontrei esse produto disponível agora. Quer ver outras opções?`;
  }

  // Resultado exato — resposta normal
  if (dropped.length === 0) {
    return formatOffersResponse(offers, matched);
  }

  // Resultado com filtros relaxados — informa o que não encontrou
  const originalSize  = original.attributes?.size  ? String(original.attributes.size)  : undefined;
  const originalColor = original.attributes?.color ? String(original.attributes.color) : undefined;
  const originalSub   = original.subcategory;

  const notFound: string[] = [];
  if (originalSub   && !matched.subcategory)              notFound.push(`*${originalSub}*`);
  if (originalColor && !matched.attributes?.color)        notFound.push(`cor *${originalColor}*`);
  if (originalSize  && !matched.attributes?.size)         notFound.push(`tamanho *${originalSize}*`);

  if (notFound.length === 0) {
    return formatOffersResponse(offers, matched);
  }

  const notFoundStr = notFound.join(' ');
  const actualSub   = offers[0]?.subcategory ?? matched.subcategory;
  const catalogUrl  = buildCatalogUrl({ ...matched, subcategory: actualSub });
  const urlLine     = catalogUrl ? `\n🔗 ${catalogUrl}` : '';

  if (originalSize && !matched.attributes?.size) {
    return `Não encontrei ${notFoundStr} especificamente. Veja os tamanhos disponíveis:${urlLine}`;
  }

  return `Não encontrei ${notFoundStr} especificamente. Mas tenho isso disponível:${urlLine}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildOfferFilters — monta OfferSearchFilters a partir dos filtros detectados
// Converte BotProductSearchFilters → OfferSearchFilters para o engine
// ─────────────────────────────────────────────────────────────────────────────
export function buildOfferFilters(
  businessId: string,
  raw: BotProductSearchFilters,
): OfferSearchFilters {
  const attributes: Record<string, unknown> = {};
  if (raw.size)  attributes.size  = raw.size;
  if (raw.color) attributes.color = raw.color;

  return {
    businessId,
    query:       raw.query,
    category:    raw.category,
    subcategory: raw.subcategory,
    maxPrice:    raw.maxPrice,
    attributes:  Object.keys(attributes).length ? attributes : undefined,
    onlyActive:  true,
  };
}
