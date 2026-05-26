// Tipos que o bot usa para falar sobre produtos.
// Mapeados do schema real do site (tabela `products`).

export interface BotProduct {
  id: string | number;
  storeId: string;          // loja à qual o produto pertence
  name: string;
  category?: string;
  subcategory?: string;        // marca/modelo: Lacoste, Nike, Adidas...
  price?: number;              // undefined = não encontrado no banco
  sizes: string[];             // tamanhos COM estoque disponível
  allSizes: string[];          // todos os tamanhos cadastrados
  colors?: string[];           // extraído do nome se presente
  imageUrl?: string;
  productUrl?: string;         // link para o produto no site
  isActive: boolean;           // stock > 0
  stockQuantity?: number;
  isFeatured?: boolean;
}

export interface BotProductSearchFilters {
  query?: string;       // busca livre no nome
  category?: string;    // camisa | tenis | bermuda | calça | bone | kit
  subcategory?: string; // marca/modelo: lacoste | nike | adidas...
  size?: string;        // P | M | G | GG | 38 | 40...
  color?: string;       // preta | branca | azul...
  maxPrice?: number;
  featuredOnly?: boolean;
}

// Shape bruto vindo do Supabase do site (tabela products)
export interface SiteProductRow {
  id: number;
  sku: string;
  name: string;
  price: number;
  category: string;
  subcategory?: string;
  image?: string;
  stock: number;
  sizes: Array<{ size: string; stock: number }>;
  featured: boolean;
}
