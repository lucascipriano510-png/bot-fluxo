/**
 * Adapta produtos do catálogo (BotProduct) para o formato genérico BusinessOffer.
 * Quando as lojas cadastrarem produtos direto no painel SaaS, este mapper
 * não será mais necessário.
 */

import { BotProduct } from '../inventory/inventoryTypes';
import { BusinessOffer, OfferType, AvailabilityType } from './offerTypes';

export function botProductToOffer(product: BotProduct): BusinessOffer {
  const offerType: OfferType =
    product.itemType === 'servico'      ? 'service'        :
    product.itemType === 'pacote_combo' ? 'kit'            :
    product.itemType === 'orcamento'    ? 'custom_quote'   :
    'physical_product';

  const availabilityType: AvailabilityType =
    product.itemType === 'servico'      ? 'unlimited' :
    product.itemType === 'pacote_combo' ? 'unlimited' :
    product.itemType === 'orcamento'    ? 'manual'    :
    'stock';

  const attributes: Record<string, unknown> = {};
  if (product.sizes?.length)              attributes.sizes  = product.sizes;
  if (product.colors?.length)             attributes.color  = product.colors[0];
  if ((product.colors?.length ?? 0) > 1)  attributes.colors = product.colors;

  return {
    id:                     String(product.id),
    businessId:             product.storeId,
    offerType,
    name:                   product.name,
    description:            product.description,
    price:                  product.price,
    promotionalPrice:       null,
    category:               product.category,
    subcategory:            product.subcategory,
    attributes,
    availabilityType,
    stockQuantity:          product.stockQuantity,
    imageUrl:               product.imageUrl,
    productUrl:             product.productUrl,
    isActive:               product.isActive,
    priceType:              product.priceType,
    botInstructions:        product.botInstructions,
    qualificationQuestions: product.qualificationQuestions,
    tags:                   product.tags,
  };
}

export function manyToOffers(products: BotProduct[]): BusinessOffer[] {
  return products.map(botProductToOffer);
}
