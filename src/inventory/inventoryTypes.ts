// Tipos que o bot usa para falar sobre produtos.
// Mapeados do schema real do site (tabela `products`).

export interface BotProduct {
  id: string | number;
  name: string;
  category?: string;
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
  size?: string;        // P | M | G | GG | 38 | 40...
  color?: string;       // preta | branca | azul...
  maxPrice?: number;
  featuredOnly?: boolean;
}

// Shape bruto vindo do Supabase do site
export interface SiteProductRow {
  id: number;
  sku: string;
  name: string;
  price: number;
  category: string;
  image?: string;
  stock: number;
  sizes: Array<{ size: string; stock: number }>;
  featured: boolean;
  gallery?: string[];
  subcategory?: string;
  collection_name?: string;
  is_kit?: boolean;
}
