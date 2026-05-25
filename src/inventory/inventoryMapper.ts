import { SiteProductRow, BotProduct } from './inventoryTypes';
import { normalizeText } from './inventoryUtils';

const SITE_URL = process.env.SITE_URL || 'https://fluxooutlet.com.br';

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

export function mapSiteProductToBotProduct(row: SiteProductRow): BotProduct {
  const availableSizes = (row.sizes || [])
    .filter(s => s.stock > 0)
    .map(s => s.size);

  const allSizes = (row.sizes || []).map(s => s.size);
  const colors   = extractColors(row.name);

  return {
    id:            row.id,
    name:          row.name,
    category:      mapCategory(row.category),
    price:         row.price ?? undefined,
    sizes:         availableSizes,
    allSizes,
    colors:        colors.length ? colors : undefined,
    imageUrl:      row.image || undefined,
    productUrl:    row.sku ? `${SITE_URL}/produto/${row.sku}` : undefined,
    isActive:      row.stock > 0,
    stockQuantity: row.stock,
    isFeatured:    row.featured,
  };
}

export function mapMany(rows: SiteProductRow[]): BotProduct[] {
  return rows.map(mapSiteProductToBotProduct);
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
    .map(c => COLOR_TERMS[COLOR_TERMS_NORM.indexOf(c)]);  // retorna versão original com acento
}
