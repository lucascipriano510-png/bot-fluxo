import { SiteProductRow, BotProduct } from './inventoryTypes';
import { normalizeText } from './inventoryUtils';

// URL base do site (SPA). Produto é aberto via deeplink: SITE_URL/?produto=SKU
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

// Mapa de categoria DB (uppercase) → exibição para o cliente
const DB_CAT_DISPLAY: Record<string, string> = {
  'CAMISA':   'camisa',
  'CALÇA':    'calça',
  'BERMUDA':  'bermuda',
  'CHINELO':  'chinelo',
  'KITS':     'kit',
  'ÓCULOS ':  'óculos',   // trailing space conforme gravado no banco
  'TÊNIS':    'tênis',
};

// Termos de cor pré-normalizados para comparação case/acento-insensitive
const COLOR_TERMS: string[] = [
  'preta','preto','branca','branco','azul','vermelha','vermelho',
  'verde','amarela','amarelo','cinza','bege','vinho','navy','off-white',
  'laranja','rosa','roxo','lilas','caramelo','marrom','creme','nude',
];
const COLOR_TERMS_NORM = COLOR_TERMS.map(normalizeText);

export function mapSiteProductToBotProduct(row: SiteProductRow, storeId: string): BotProduct {
  const availableSizes = (row.sizes || [])
    .filter(s => s.stock > 0)
    .map(s => s.size);

  const allSizes = (row.sizes || []).map(s => s.size);
  const colors   = extractColors(row.name);

  return {
    id:            row.id,
    storeId,
    name:          row.name,
    category:      mapCategory(row.category),
    subcategory:   row.subcategory || undefined,
    price:         row.price ?? undefined,
    sizes:         availableSizes,
    allSizes,
    colors:        colors.length ? colors : undefined,
    imageUrl:      row.image || undefined,
    productUrl:    SITE_URL ? `${SITE_URL}/?produto=${row.sku || row.id}` : undefined,
    isActive:      row.stock > 0,
    stockQuantity: row.stock,
    isFeatured:    row.featured,
  };
}

export function mapMany(rows: SiteProductRow[], storeId: string): BotProduct[] {
  return rows.map(row => mapSiteProductToBotProduct(row, storeId));
}

// Normaliza a categoria do banco para exibição ao cliente
function mapCategory(dbCategory: string): string {
  return DB_CAT_DISPLAY[dbCategory] ?? dbCategory.trim().toLowerCase();
}

// Extrai cores do nome do produto de forma case/acento-insensitive
function extractColors(name: string): string[] {
  const norm = normalizeText(name);
  return COLOR_TERMS_NORM
    .filter(c => norm.includes(c))
    .map(c => COLOR_TERMS[COLOR_TERMS_NORM.indexOf(c)]);
}
