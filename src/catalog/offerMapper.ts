/**
 * Adapta produtos atuais da Fluxo Outlet (BotProduct) para o formato
 * genérico BusinessOffer — sem alterar banco, sem alterar InventoryBridge.
 *
 * Este mapper é o "tradutor" temporário enquanto a Fluxo Outlet ainda usa
 * o catálogo do site. Quando migrar para o painel SaaS, os dados já entram
 * como BusinessOffer nativamente e este mapper não é mais necessário.
 */

import { BotProduct } from '../inventory/inventoryTypes';
import { BusinessOffer, OfferType, AvailabilityType } from './offerTypes';

export function botProductToOffer(product: BotProduct): BusinessOffer {
  const offerType: OfferType = product.isFeatured === undefined && product.isActive
    ? 'physical_product'
    : product.stockQuantity === 0
      ? 'physical_product'  // sem estoque mas existente
      : 'physical_product'; // Fluxo Outlet só tem produtos físicos por enquanto

  const availabilityType: AvailabilityType = 'stock';

  // Atributos extraídos do produto físico
  const attributes: Record<string, unknown> = {};
  if (product.sizes?.length)           attributes.sizes  = product.sizes;
  if (product.colors?.length)          attributes.color  = product.colors[0];
  if ((product.colors?.length ?? 0) > 1) attributes.colors = product.colors;

  return {
    id:                String(product.id),
    businessId:        product.storeId,
    offerType,
    name:              product.name,
    price:             product.price,
    promotionalPrice:  null,
    category:          product.category,
    subcategory:       product.subcategory,
    attributes,
    availabilityType,
    stockQuantity:     product.stockQuantity,
    imageUrl:          product.imageUrl,
    productUrl:        product.productUrl,
    isActive:          product.isActive,
  };
}

export function manyToOffers(products: BotProduct[]): BusinessOffer[] {
  return products.map(botProductToOffer);
}
