// ═══════════════════════════════════════════════════════════════════════════
//  storeKnowledgeService — Store Intelligence Layer do Fluxo Command.
//
//  Agrega fontes de conhecimento da loja em uma StoreKnowledgeBase estruturada.
//  O bot SÓ afirma fatos presentes nessa base. Se não souber, pergunta ou
//  encaminha para humano — nunca inventa.
//
//  Próximos conectores (a implementar com tokens/webhooks):
//  - website:          crawler controlado via SITE_URL
//  - instagram:        Meta Graph API + page token
//  - whatsapp_history: análise de conversas via Evolution API
//  - meta_ads:         Meta Marketing API + ad account token
// ═══════════════════════════════════════════════════════════════════════════

import { getBusinessProfile } from './storeProfileService';
import { getRuntimeSettings, BotSettings } from './settingsService';
import type { SiteScanResult } from './siteScanService';

// ── Source types ─────────────────────────────────────────────────────────────

export type SourceType =
  | 'manual_profile'
  | 'catalog'
  | 'website'
  | 'instagram'
  | 'whatsapp_history'
  | 'meta_ads'
  | 'owner_instructions'
  | 'ai_tool';

export type SourceStatus = 'connected' | 'pending' | 'pending_scan' | 'configured_profile' | 'unavailable' | 'error';

export interface KnowledgeSource {
  sourceType:     SourceType;
  status:         SourceStatus;
  lastSyncAt?:    string;
  confidence:     number;      // 0–1
  extractedFacts: Record<string, string>;
  rawSummary?:    string;
  warnings?:      string[];
}

// ── Sensors (estrutura preparada para futura integração real) ────────────────

export interface WebsiteSensor {
  websiteUrl?:  string;
  sitemapUrl?:  string;
  catalogUrl?:  string;
  lastScanAt?:  string;
  status:       SourceStatus;
  extracted?: {
    storeName?:        string;
    categories?:       string[];
    products?:         string[];
    importantLinks?:   string[];
    policies?:         string[];
    faqs?:             string[];
    commercialCalls?:  string[];
  };
  rawSummary?: string;
  note: string;
}

export interface InstagramSensor {
  instagramHandle?:      string;
  connectionStatus:      SourceStatus;
  profileBio?:           string;
  profileLinks?:         string[];
  recentContentSummary?: string;
  commonComments?:       string[];
  brandToneSignals?:     string[];
  note: string;  // caminho para conexão oficial
}

export interface WhatsAppSensor {
  connectionStatus:       SourceStatus;
  conversationSummaries?: string[];
  frequentQuestions?:     string[];
  ownerReplyStyle?:       string;
  commonObjections?:      string[];
  closingPatterns?:       string[];
  handoffRules?:          string[];
  note: string;
}

export interface AiToolSensor {
  toolName:             string;
  purpose:              string;
  outputsSummary?:      string;
  usableInstructions?:  string[];
  warnings?:            string[];
}

// ── Knowledge gaps ───────────────────────────────────────────────────────────

export interface KnowledgeGap {
  field:       string;
  description: string;
  howToFix:    string;
  priority:    'high' | 'medium' | 'low';
}

// ── Full knowledge base ──────────────────────────────────────────────────────

export interface StoreKnowledgeBase {
  storeId: string;
  builtAt: string;

  identity: {
    storeName?:    string;
    businessType?: string;
    city?:         string;
    state?:        string;
    address?:      string;
    instagram?:    string;
    whatsapp?:     string;
    confidence:    number;
  };

  commercial: {
    deliveryInfo?:   string;
    paymentInfo?:    string;
    discountRules?:  string;
    returnPolicy?:   string;
    openingHours?:   string;
    siteUrl?:        string;
    catalogUrl?:     string;
    confidence:      number;
  };

  voice: {
    salesTone?:           string;
    salesInstructions?:   string;
    humanHandoffMessage?: string;
    confidence:           number;
  };

  catalog: {
    available:  boolean;
    confidence: number;
  };

  websiteSensor:   WebsiteSensor;
  instagramSensor: InstagramSensor;
  whatsappSensor:  WhatsAppSensor;
  aiTools:         AiToolSensor[];

  sources:            KnowledgeSource[];
  knowledgeGaps:      KnowledgeGap[];
  unknownsToAskOwner: string[];
}

// ── Runtime context (leve, para cada mensagem) ───────────────────────────────

export interface RuntimeKnowledgeContext {
  storeName:      string;
  identity:       StoreKnowledgeBase['identity'];
  commercial:     StoreKnowledgeBase['commercial'];
  voice:          StoreKnowledgeBase['voice'];
  catalog:        StoreKnowledgeBase['catalog'];
  websiteSensor?: WebsiteSensor;
  gaps:           string[];
  // Retorna true se há dados confiáveis sobre o tópico
  safeToAnswer: (topic: string) => boolean;
}

// ── Normalização de Instagram ────────────────────────────────────────────────

function normalizeInstagram(handle: string): string {
  const clean = handle.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : '';
}

// ── Cache (60s TTL) ──────────────────────────────────────────────────────────

const _cache    = new Map<string, { data: StoreKnowledgeBase; expiresAt: number }>();
const TTL_MS    = 60_000;
const _scanCache = new Map<string, SiteScanResult>();

export function updateSiteScan(storeId: string, result: SiteScanResult): void {
  _scanCache.set(storeId, result);
}

// ── Construção das fontes ────────────────────────────────────────────────────

function buildSources(
  profile: Awaited<ReturnType<typeof getBusinessProfile>>,
  settings: BotSettings,
): KnowledgeSource[] {
  const now = new Date().toISOString();

  return [
    {
      sourceType: 'manual_profile',
      status:     'connected',
      lastSyncAt: now,
      confidence: profile.storeName ? 0.90 : 0.40,
      extractedFacts: {
        storeName:    profile.storeName     || '',
        city:         profile.city          || '',
        state:        profile.state         || '',
        deliveryInfo: profile.deliveryInfo  || '',
        instagram:    profile.instagram     || '',
        salesTone:    profile.salesTone     || '',
      },
      rawSummary: 'Perfil construído a partir de variáveis de ambiente e bot_settings.',
    },
    {
      sourceType: 'catalog',
      status:     'connected',
      lastSyncAt: now,
      confidence: 0.95,
      extractedFacts: { connected: 'true' },
      rawSummary: 'Catálogo conectado via InventoryBridge.',
    },
    {
      sourceType: 'website',
      status:     'unavailable',
      confidence: 0,
      extractedFacts: {},
      warnings: ['Configure SITE_URL para ativar scan controlado do site.'],
    },
    {
      sourceType: 'instagram',
      status:     profile.instagram ? 'pending' : 'unavailable',
      confidence: 0,
      extractedFacts: profile.instagram ? { handle: profile.instagram } : {},
      warnings: ['Integração oficial via Meta/Instagram Graph API necessária para extrair dados reais.'],
    },
    {
      sourceType: 'whatsapp_history',
      status:     (settings.evolution_url && settings.evolution_instance) ? 'pending' : 'unavailable',
      confidence: 0,
      extractedFacts: {},
      warnings: ['Análise de histórico disponível após conectar Evolution API e implementar pipeline de análise.'],
    },
    {
      sourceType: 'meta_ads',
      status:     'unavailable',
      confidence: 0,
      extractedFacts: {},
      warnings: ['Meta Marketing API + token de conta de anúncio necessários.'],
    },
  ];
}

// ── Gaps de conhecimento ─────────────────────────────────────────────────────

function computeGaps(
  profile: Awaited<ReturnType<typeof getBusinessProfile>>,
  settings: BotSettings,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];

  if (!profile.city)
    gaps.push({ field: 'city', description: 'Cidade não cadastrada', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'high' });

  if (!profile.state)
    gaps.push({ field: 'state', description: 'Estado não cadastrado', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'medium' });

  if (!profile.deliveryInfo)
    gaps.push({ field: 'deliveryInfo', description: 'Informações de entrega não cadastradas', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'high' });

  if (!profile.paymentInfo)
    gaps.push({ field: 'paymentInfo', description: 'Formas de pagamento não cadastradas', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'high' });

  if (!settings.horario_inicio || !settings.horario_fim)
    gaps.push({ field: 'openingHours', description: 'Horário de funcionamento não cadastrado', howToFix: 'Configure em Configurações → Horário.', priority: 'medium' });

  if (!profile.instagram)
    gaps.push({ field: 'instagram', description: 'Instagram não cadastrado', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'medium' });

  if (!profile.siteUrl)
    gaps.push({ field: 'website', description: 'Site da loja não cadastrado', howToFix: 'Preencha a URL em Configurações → Perfil da Loja.', priority: 'low' });

  if (!profile.discountRules)
    gaps.push({ field: 'discountRules', description: 'Regras de desconto não cadastradas', howToFix: 'Preencha em Configurações → Perfil da Loja.', priority: 'medium' });

  if (!settings.evolution_url)
    gaps.push({ field: 'whatsapp_connector', description: 'WhatsApp real não conectado', howToFix: 'Configure Evolution API em Integrações.', priority: 'high' });

  return gaps;
}

// ── Construção da knowledge base ─────────────────────────────────────────────

export async function getStoreKnowledge(storeId: string): Promise<StoreKnowledgeBase> {
  const now = Date.now();
  const cached = _cache.get(storeId);
  if (cached && now < cached.expiresAt) return cached.data;

  const [profile, settings] = await Promise.all([
    getBusinessProfile(storeId),
    getRuntimeSettings(storeId),
  ]);

  const sources = buildSources(profile, settings);
  const gaps    = computeGaps(profile, settings);

  const kb: StoreKnowledgeBase = {
    storeId,
    builtAt: new Date().toISOString(),

    identity: {
      storeName:    profile.storeName,
      businessType: profile.businessType,
      city:         profile.city,
      state:        profile.state,
      instagram:    profile.instagram ? normalizeInstagram(profile.instagram) : undefined,
      whatsapp:     profile.whatsapp || settings.whatsapp || undefined,
      confidence:   (() => {
        const filled = [profile.storeName, profile.city, profile.state, profile.instagram].filter(Boolean).length;
        return filled >= 3 ? 0.90 : filled >= 2 ? 0.70 : filled >= 1 ? 0.50 : 0.30;
      })(),
    },

    commercial: {
      deliveryInfo:  profile.deliveryInfo,
      paymentInfo:   profile.paymentInfo,
      openingHours:  profile.openingHours,
      discountRules: profile.discountRules,
      returnPolicy:  profile.returnPolicy,
      siteUrl:       profile.siteUrl,
      catalogUrl:    profile.catalogUrl,
      confidence:    (() => {
        const filled = [profile.deliveryInfo, profile.paymentInfo, profile.openingHours].filter(Boolean).length;
        return filled >= 2 ? 0.80 : filled >= 1 ? 0.50 : 0.20;
      })(),
    },

    voice: {
      salesTone:         profile.salesTone,
      salesInstructions: profile.salesInstructions,
      confidence:        profile.salesTone ? 0.80 : 0.50,
    },

    catalog: { available: true, confidence: 0.95 },

    websiteSensor: (() => {
      const scan = _scanCache.get(storeId);
      if (scan) {
        return {
          websiteUrl:  profile.siteUrl || undefined,
          catalogUrl:  profile.catalogUrl || undefined,
          status:      'connected' as const,
          lastScanAt:  scan.scannedAt,
          extracted: {
            storeName:  scan.title,
            importantLinks: scan.internalLinks,
          },
          rawSummary: scan.rawSummary,
          note:        `Sincronizado em ${new Date(scan.scannedAt).toLocaleString('pt-BR')}. ${scan.title ? 'Título: ' + scan.title : ''}`,
        };
      }
      return {
        websiteUrl:  profile.siteUrl || undefined,
        catalogUrl:  profile.catalogUrl || undefined,
        status:      profile.siteUrl ? 'pending_scan' as const : 'unavailable' as const,
        note:        profile.siteUrl
          ? 'Site configurado. Clique em "Analisar site" para sincronizar.'
          : 'Configure o site em Configurações → Perfil da Loja.',
      };
    })(),

    instagramSensor: {
      instagramHandle:  profile.instagram ? normalizeInstagram(profile.instagram) : undefined,
      connectionStatus: profile.instagram ? 'configured_profile' : 'unavailable',
      note: profile.instagram
        ? 'Perfil configurado. Integração oficial via Meta/Instagram Graph API pendente.'
        : 'Configure o Instagram em Configurações → Perfil da Loja.',
    },

    whatsappSensor: {
      connectionStatus: settings.evolution_url ? 'pending' : 'unavailable',
      note: 'Análise de histórico disponível após conectar Evolution API e pipeline de análise.',
    },

    aiTools: [{
      toolName: 'Gemini',
      purpose:  'Respostas conversacionais controladas pela StoreKnowledgeBase',
      usableInstructions: [
        'Nunca inventar produto, preço, estoque ou desconto',
        'Se dado ausente, perguntar ou encaminhar para humano',
      ],
    }],

    sources,
    knowledgeGaps:      gaps,
    unknownsToAskOwner: gaps.filter(g => g.priority === 'high').map(g => g.description),
  };

  _cache.set(storeId, { data: kb, expiresAt: now + TTL_MS });
  return kb;
}

// ── Runtime context (chamado pelo engine antes de responder) ─────────────────

export async function buildRuntimeKnowledgeContext(storeId: string): Promise<RuntimeKnowledgeContext> {
  const kb = await getStoreKnowledge(storeId);

  return {
    storeName:     kb.identity.storeName || 'nossa loja',
    identity:      kb.identity,
    commercial:    kb.commercial,
    voice:         kb.voice,
    catalog:       kb.catalog,
    websiteSensor: kb.websiteSensor.status === 'connected' ? kb.websiteSensor : undefined,
    gaps:          kb.knowledgeGaps.map(g => g.field),
    safeToAnswer: (topic: string) => !kb.knowledgeGaps.some(g => g.field === topic),
  };
}

// ── Lista de gaps (para o painel) ────────────────────────────────────────────

export async function listKnowledgeGaps(storeId: string): Promise<KnowledgeGap[]> {
  const kb = await getStoreKnowledge(storeId);
  return kb.knowledgeGaps;
}

export function clearKnowledgeCache(storeId: string): void {
  _cache.delete(storeId);
}
