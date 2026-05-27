// Tipos que o bot usa para falar sobre produtos/serviços/combos/orçamentos.
// Mapeados do schema real da tabela `products` (catálogo universal).

export interface BotProduct {
  id: string | number;
  storeId: string;            // loja à qual o item pertence
  name: string;
  category?: string;
  subcategory?: string;       // marca/modelo: Lacoste, Nike...
  price?: number;
  sizes: string[];            // tamanhos COM estoque disponível
  allSizes: string[];         // todos os tamanhos cadastrados
  colors?: string[];
  imageUrl?: string;
  productUrl?: string;
  isActive: boolean;
  stockQuantity?: number;
  isFeatured?: boolean;

  // ── Catálogo universal ────────────────────────────────────────────────
  itemType: string;            // produto_fisico | servico | pacote_combo | orcamento
  description?: string;        // descrição curta
  priceType: string;           // fixo | a_partir_de | sob_consulta
  botInstructions?: string;    // instrução específica para o bot
  qualificationQuestions?: unknown; // perguntas de qualificação (jsonb)
  tags?: string[];             // palavras-chave para busca
}

export interface BotProductSearchFilters {
  query?: string;       // busca livre no nome/descrição
  category?: string;    // camisa | tenis | bermuda | etc
  subcategory?: string; // marca/modelo: lacoste | nike | etc
  size?: string;        // P | M | G | GG | 38...
  color?: string;       // preta | branca | azul...
  maxPrice?: number;
  featuredOnly?: boolean;
}

// Shape bruto vindo do Supabase (tabela products — catálogo universal)
export interface SiteProductRow {
  id: number;
  sku: string;
  name: string;
  price: number;
  promotional_price?: number;
  category: string;
  subcategory?: string;
  image?: string;
  image_url?: string;
  stock: number;
  sizes: Array<{ size: string; stock: number }>;
  featured: boolean;
  is_active?: boolean;
  color?: string;
  product_type?: string;

  // Campos universais (pode ser null em produtos legados)
  item_type?: string;
  description?: string;
  price_type?: string;
  duration_minutes?: number;
  requires_scheduling?: boolean;
  service_location?: string;
  included_items?: string;
  qualification_questions?: unknown;
  bot_instructions?: string;
  tags?: string[];
  variations?: unknown;
}
