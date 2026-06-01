// ═══════════════════════════════════════════════════════════════════════════
//  storeBrainService — Cérebro aprendível da loja.
//
//  Lê padrões acumulados de conversas reais e injeta no contexto da IA.
//  Atualizado pelo analysisService periodicamente.
//  Leitura cacheada por 5 minutos — leve o suficiente para cada mensagem.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';

export interface StoreBrain {
  business_context?:       string;
  catalog_summary?:        string;
  price_range?:            string;
  top_products?:           Array<{ name: string; category: string; avg_price: number; consult_count: number }>;
  successful_patterns?:    Array<{ pattern: string; context: string; conversion_rate: number }>;
  objection_map?:          Record<string, string>;
  closing_signals?:        string[];
  handoff_triggers?:       string[];
  customer_profile?:       string;
  peak_hours?:             Record<string, string>;
  avg_conversation_turns?: number;
  weekly_top_queries?:     string[];
  weekly_objections?:      string[];
  conversion_rate_week?:   number;
  hot_products_now?:       string[];
  last_analysis_at?:       string;
  conversations_analyzed?: number;
}

// Cache 5 minutos — lido a cada mensagem, não pode ser lento
const _cache = new Map<string, { data: StoreBrain; expiresAt: number }>();
const TTL = 5 * 60 * 1000;

export async function getStoreBrain(storeId: string): Promise<StoreBrain> {
  const now = Date.now();
  const cached = _cache.get(storeId);
  if (cached && now < cached.expiresAt) return cached.data;

  const { data } = await supabase
    .from('store_brain')
    .select('*')
    .eq('store_id', storeId)
    .single();

  const brain: StoreBrain = data || {};
  _cache.set(storeId, { data: brain, expiresAt: now + TTL });
  return brain;
}

export function clearBrainCache(storeId: string): void {
  _cache.delete(storeId);
}

// Monta a seção de inteligência da loja para injetar no system prompt
export function buildBrainContext(brain: StoreBrain): string {
  if (!brain || Object.keys(brain).length === 0) return '';

  const sections: string[] = [];

  if (brain.business_context) {
    sections.push(`NEGÓCIO:\n${brain.business_context}`);
  }

  if (brain.hot_products_now?.length) {
    sections.push(`MAIS CONSULTADOS AGORA:\n${brain.hot_products_now.slice(0, 5).join(', ')}`);
  }

  if (brain.weekly_top_queries?.length) {
    sections.push(`CLIENTES ESTÃO PERGUNTANDO MUITO SOBRE:\n${brain.weekly_top_queries.slice(0, 5).join(', ')}`);
  }

  if (brain.objection_map && Object.keys(brain.objection_map).length > 0) {
    const obj = Object.entries(brain.objection_map)
      .slice(0, 4)
      .map(([k, v]) => `- "${k}" → ${v}`)
      .join('\n');
    sections.push(`COMO TRATAR OBJEÇÕES NESTA LOJA:\n${obj}`);
  }

  if (brain.successful_patterns?.length) {
    const patterns = brain.successful_patterns
      .sort((a, b) => b.conversion_rate - a.conversion_rate)
      .slice(0, 3)
      .map(p => `- ${p.pattern}`)
      .join('\n');
    sections.push(`O QUE FUNCIONA NESTA LOJA (use como referência):\n${patterns}`);
  }

  if (brain.closing_signals?.length) {
    sections.push(`QUANDO O CLIENTE FALA ISSO ELE ESTÁ PRONTO PARA COMPRAR:\n${brain.closing_signals.slice(0, 4).join(', ')}`);
  }

  if (brain.customer_profile) {
    sections.push(`PERFIL DOS CLIENTES DESTA LOJA:\n${brain.customer_profile}`);
  }

  if (brain.price_range) {
    sections.push(`FAIXA DE PREÇO DOS PRODUTOS: ${brain.price_range}`);
  }

  if (sections.length === 0) return '';

  return `\nINTELIGÊNCIA DA LOJA (aprendido de conversas reais):\n${sections.join('\n\n')}`;
}

// Salva resultado de conversão — captura o que funcionou
export async function recordConversion(
  storeId: string,
  phone: string,
  type: 'bot_converted' | 'human_converted',
): Promise<void> {
  try {
    const { data: msgs } = await supabase
      .from('bot_mensagens')
      .select('conteudo, direcao, node')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .order('criado_em', { ascending: false })
      .limit(10);

    if (!msgs || msgs.length === 0) return;

    const botReplies = msgs
      .filter((m: { direcao: string; node: string; conteudo: string }) => m.direcao === 'saida' && m.node !== 'HUMANO')
      .map((m: { conteudo: string }) => m.conteudo)
      .slice(0, 3);

    if (botReplies.length === 0) return;

    await supabase.from('store_conversion_events').insert({
      store_id:    storeId,
      phone,
      type,
      bot_replies: botReplies,
      created_at:  new Date().toISOString(),
    });
  } catch (err) {
    console.error('[StoreBrain] recordConversion error:', err);
  }
}
