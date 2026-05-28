// ═══════════════════════════════════════════════════════════════════════════
//  storeProfileService — Perfil de negócio usado pelo bot e pela IA.
//
//  Combina dados de bot_settings (já existente) com variáveis de ambiente
//  para construir contexto rico sem precisar de nova tabela ou migration.
//
//  Variáveis de ambiente opcionais (configure na Vercel se quiser usar):
//    STORE_BUSINESS_TYPE  — ex: "outlet de roupas masculina"
//    STORE_CITY           — ex: "Uberaba"
//    STORE_STATE          — ex: "MG"
//    STORE_DELIVERY_INFO  — ex: "Enviamos para todo o Brasil"
//    STORE_PAYMENT_INFO   — ex: "Pix, cartão, boleto"
//    STORE_INSTAGRAM      — ex: "@fluxooutlet034"
//    STORE_SALES_TONE     — ex: "direto, humano, vendedor, sem enrolação"
//    STORE_SALES_INSTRUCTIONS — instruções extras para a IA
// ═══════════════════════════════════════════════════════════════════════════

import { getRuntimeSettings } from './settingsService';

export interface BusinessProfile {
  storeName:               string;
  businessType?:           string;
  city?:                   string;
  state?:                  string;
  address?:                string;
  deliveryInfo?:           string;
  paymentInfo?:            string;
  openingHours?:           string;
  instagram?:              string;
  whatsapp?:               string;
  salesTone?:              string;
  salesInstructions?:      string;
  humanHandoffMessage?:    string;
  defaultFallbackMessage?: string;
}

function fromEnv(): Partial<BusinessProfile> {
  return {
    businessType:      process.env.STORE_BUSINESS_TYPE      || undefined,
    city:              process.env.STORE_CITY               || undefined,
    state:             process.env.STORE_STATE              || undefined,
    deliveryInfo:      process.env.STORE_DELIVERY_INFO      || undefined,
    paymentInfo:       process.env.STORE_PAYMENT_INFO       || undefined,
    instagram:         process.env.STORE_INSTAGRAM          || undefined,
    salesTone:         process.env.STORE_SALES_TONE         || undefined,
    salesInstructions: process.env.STORE_SALES_INSTRUCTIONS || undefined,
  };
}

// Cache leve — TTL 60s, mesma estratégia de settingsService
const _cache = new Map<string, { data: BusinessProfile; expiresAt: number }>();
const TTL_MS = 60_000;

export async function getBusinessProfile(storeId: string): Promise<BusinessProfile> {
  const now = Date.now();
  const cached = _cache.get(storeId);
  if (cached && now < cached.expiresAt) return cached.data;

  const settings = await getRuntimeSettings(storeId);
  const env      = fromEnv();

  const profile: BusinessProfile = {
    storeName:    settings.nome_loja || env.businessType || 'nossa loja',
    businessType: env.businessType,
    city:         env.city,
    state:        env.state,
    deliveryInfo: env.deliveryInfo,
    paymentInfo:  env.paymentInfo,
    instagram:    env.instagram,
    whatsapp:     settings.whatsapp || undefined,
    salesTone:    env.salesTone     || 'direto, humano e objetivo',
    salesInstructions: env.salesInstructions,
    openingHours: (settings.horario_inicio && settings.horario_fim)
      ? `${settings.horario_inicio} às ${settings.horario_fim}`
      : undefined,
  };

  _cache.set(storeId, { data: profile, expiresAt: now + TTL_MS });
  return profile;
}

// Limpa cache quando settings são alterados
export function clearProfileCache(storeId: string): void {
  _cache.delete(storeId);
}
