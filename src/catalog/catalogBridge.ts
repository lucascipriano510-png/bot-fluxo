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

// ─────────────────────────────────────────────────────────────────────────────
// filtersToInventoryFilters
// Traduz OfferSearchFilters → BotProductSearchFilters para o adapter atual
// ─────────────────────────────────────────────────────────────────────────────
export function filtersToInventoryFilters(filters: OfferSearchFilters): BotProductSearchFilters {
  const inv: BotProductSearchFilters = {};

  if (filters.query)    inv.query    = filters.query;
  if (filters.category) inv.category = filters.category;
  if (filters.maxPrice) inv.maxPrice = filters.maxPrice;
  if (filters.onlyActive) inv.featuredOnly = false; // onlyActive não tem equivalente direto

  // Extrai atributos físicos para os filtros do InventoryBridge
  const attrs = filters.attributes || {};
  if (attrs.size)  inv.size  = String(attrs.size);
  if (attrs.color) inv.color = String(attrs.color);

  return inv;
}

// ─────────────────────────────────────────────────────────────────────────────
// findOffers — ponto único de consulta de catálogo para o motor do bot
// Garante que TODA consulta carrega businessId (nunca consulta sem contexto)
// ─────────────────────────────────────────────────────────────────────────────
export async function findOffers(filters: OfferSearchFilters): Promise<BusinessOffer[]> {
  const { businessId } = filters;

  /*
   * ROTEAMENTO POR SEGMENTO
   * Hoje: apenas Fluxo Outlet via InventoryBridge.
   * Futuro: adicionar cases aqui para outros segmentos/adapters.
   *
   *   if (businessId === 'lava-jato-x') return saasAdapter.findOffers(filters);
   *   if (segment === 'barbearia')      return appointmentAdapter.findSlots(filters);
   */

  // Adapter atual: InventoryBridge → produtos físicos da Fluxo Outlet
  const inventoryFilters = filtersToInventoryFilters(filters);
  const hasFilter = inventoryFilters.category || inventoryFilters.size
    || inventoryFilters.query || inventoryFilters.color;

  if (!hasFilter) return [];

  const products = await findProductsForBot(businessId, inventoryFilters);
  return manyToOffers(products);
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

  const catDisplay = filters.category
    ? (CAT_DISPLAY[filters.category] || filters.category)
    : null;
  const size  = filters.attributes?.size  ? String(filters.attributes.size)  : undefined;
  const color = filters.attributes?.color ? String(filters.attributes.color) : undefined;

  const fmtPrice = (p?: number | null) =>
    p != null ? `R$${p.toFixed(2).replace('.', ',')}` : null;

  if (offers.length === 1) {
    const o = offers[0];
    const sizes    = (o.attributes?.sizes as string[] | undefined) || [];
    const priceStr = fmtPrice(o.price);

    let msg = `*${o.name}*\n`;
    msg += priceStr
      ? `💰 ${priceStr}\n`
      : `💰 Vou confirmar o valor certinho pra você.\n`;
    if (sizes.length) msg += `📏 Tamanhos disponíveis: ${sizes.join(', ')}\n`;
    if (o.imageUrl)   msg += `🔗 Ver produto`;
    return msg;
  }

  if (catDisplay && size) {
    return (
      `Tenho opções em *${catDisplay}* no tamanho *${size}*. ` +
      `Quer ver as peças mais básicas ou as de destaque?\n\n` +
      offers.slice(0, 5).map(o =>
        `• ${o.name}${o.price != null ? ` — ${fmtPrice(o.price)}` : ''}`
      ).join('\n')
    );
  }

  if (catDisplay || color) {
    const line = catDisplay ? `em *${catDisplay}*` : `na cor *${color}*`;
    return (
      `Tenho algumas opções ${line}. Qual tamanho você usa?\n\n` +
      offers.slice(0, 5).map(o => `• ${o.name}`).join('\n')
    );
  }

  return (
    `Encontrei ${offers.length} opção(ões) pra você:\n\n` +
    offers.slice(0, 5).map(o =>
      `• ${o.name}${o.price != null ? ` — ${fmtPrice(o.price)}` : ''}`
    ).join('\n')
  );
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
    query:      raw.query,
    category:   raw.category,
    maxPrice:   raw.maxPrice,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    onlyActive: true,
  };
}
