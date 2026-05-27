import { SiteProductRow, BotProduct } from './inventoryTypes';
import { normalizeText } from './inventoryUtils';

const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

const DB_CAT_DISPLAY: Record<string, string> = {
  'CAMISA':   'camisa',
  'CALÇA':    'calça',
  'BERMUDA':  'bermuda',
  'CHINELO':  'chinelo',
  'KITS':     'kit',
  'ÓCULOS ':  'óculos',
  'TÊNIS':    'tênis',
};

const COLOR_TERMS: string[] = [
  'preta','preto','branca','branco','azul','vermelha','vermelho',
  'verde','amarela','amarelo','cinza','bege','vinho','navy','off-white',
  'laranja','rosa','roxo','lilas','caramelo','marrom','creme','nude',
];
const COLOR_TERMS_NORM = COLOR_TERMS.map(normalizeText);

export function mapSiteProductToBotProduct(row: SiteProductRow, storeId: string): BotProduct {
  const isPhysical = !row.item_type || row.item_type === 'produto_fisico';

  const availableSizes = isPhysical
    ? (row.sizes || []).filter(s => s.stock > 0).map(s => s.size)
    : [];
  const allSizes = (row.sizes || []).map(s => s.size);
  const colors   = extractColors(row.name);

  return {
    id:                     row.id,
    storeId,
    name:                   row.name,
    category:               mapCategory(row.category),
    subcategory:            row.subcategory || undefined,
    price:                  row.price ?? undefined,
    sizes:                  availableSizes,
    allSizes,
    colors:                 colors.length ? colors : undefined,
    imageUrl:               row.image_url || row.image || undefined,
    productUrl:             (SITE_URL && isPhysical) ? `${SITE_URL}/?produto=${row.sku || row.id}` : undefined,
    isActive:               isPhysical ? row.stock > 0 : (row.is_active !== false),
    stockQuantity:          isPhysical ? row.stock : undefined,
    isFeatured:             row.featured,
    // Universal fields
    itemType:               row.item_type || 'produto_fisico',
    description:            row.description || undefined,
    priceType:              row.price_type || 'fixo',
    botInstructions:        row.bot_instructions || undefined,
    qualificationQuestions: row.qualification_questions ?? undefined,
    tags:                   row.tags || undefined,
  };
}

export function mapMany(rows: SiteProductRow[], storeId: string): BotProduct[] {
  return rows.map(row => mapSiteProductToBotProduct(row, storeId));
}

function mapCategory(dbCategory: string): string {
  return DB_CAT_DISPLAY[dbCategory] ?? dbCategory.trim().toLowerCase();
}

function extractColors(name: string): string[] {
  const norm = normalizeText(name);
  return COLOR_TERMS_NORM
    .filter(c => norm.includes(c))
    .map(c => COLOR_TERMS[COLOR_TERMS_NORM.indexOf(c)]);
}
