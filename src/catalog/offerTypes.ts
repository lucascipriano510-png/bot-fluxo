/**
 * Tipos genéricos para o sistema de catálogo multi-segmento.
 *
 * BusinessOffer representa qualquer coisa que uma empresa vende ou oferece:
 *   - physical_product → loja de roupa, loja de celular
 *   - service          → lava-jato, barbearia, assistência técnica
 *   - kit              → combo/pacote de produtos
 *   - appointment      → agendamento com horário
 *   - custom_quote     → orçamento sob demanda
 *
 * O InventoryBridge (camada atual) alimenta o CatalogBridge mapeando
 * produtos de catálogos externos para BusinessOffer. Futuramente, lojas
 * cadastram suas offers diretamente no painel SaaS.
 */

export type OfferType =
  | 'physical_product'  // produto físico com estoque
  | 'service'           // serviço (lava-jato, corte de cabelo, reparo)
  | 'kit'               // combo/pacote de itens
  | 'appointment'       // agendamento com horário marcado
  | 'custom_quote';     // orçamento personalizado

export type AvailabilityType =
  | 'stock'      // controlado por quantidade em estoque
  | 'schedule'   // controlado por agenda/horário
  | 'manual'     // confirmação manual pelo atendente
  | 'unlimited'; // sempre disponível (serviço sem limite de vagas)

export interface BusinessOffer {
  id: string;
  businessId: string;           // storeId / slug da empresa dona da offer
  offerType: OfferType;
  name: string;
  description?: string;
  price?: number;
  promotionalPrice?: number | null;
  category?: string;
  subcategory?: string;

  /**
   * Atributos flexíveis — variam por segmento:
   *   Loja de roupa:  { color, sizes, material }
   *   Lava-jato:      { vehicleType, serviceLevel }
   *   Barbearia:      { duration, professional }
   *   Assistência:    { deviceBrand, deviceModel, issueType }
   */
  attributes?: Record<string, unknown>;

  availabilityType?: AvailabilityType;
  stockQuantity?: number;
  imageUrl?: string;
  productUrl?: string;
  isActive: boolean;
}

export interface OfferSearchFilters {
  businessId: string;             // obrigatório — garante isolamento entre empresas
  query?: string;                 // busca livre no nome/descrição
  offerType?: OfferType;
  category?: string;
  subcategory?: string;
  attributes?: Record<string, unknown>;  // ex: { size: 'G', color: 'preta', vehicleType: 'SUV' }
  maxPrice?: number;
  onlyActive?: boolean;
}
