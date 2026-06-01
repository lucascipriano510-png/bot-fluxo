// ═══════════════════════════════════════════════════════════════════════════
//  analysisService — Motor de aprendizado da loja.
//
//  Lê conversas dos últimos 7 dias, usa a IA para identificar padrões,
//  e atualiza store_brain com o que aprendeu.
//
//  Custo: uma chamada à API por análise (batch, não por mensagem).
//  Frequência recomendada: 1x por dia, via cron ou botão no painel.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';
import { clearBrainCache } from './storeBrainService';
import { loadStoreCategories } from '../inventory/inventoryBridge';

async function callGeminiAnalysis(prompt: string): Promise<string | null> {
  const key   = process.env.AI_ASSIST_KEY || '';
  const model = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';
  if (!key) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 1500, temperature: 0.3 },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) return null;
  const json = await resp.json() as Record<string, unknown>;
  const candidate = (json?.candidates as Array<Record<string, unknown>>)?.[0];
  const content   = candidate?.content as Record<string, unknown>;
  const parts     = content?.parts as Array<Record<string, unknown>>;
  return (parts?.[0]?.text as string)?.trim() || null;
}

export async function runStoreAnalysis(storeId: string): Promise<{
  ok: boolean;
  conversationsAnalyzed: number;
  error?: string;
}> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: messages } = await supabase
      .from('bot_mensagens')
      .select('phone, conteudo, direcao, node, criado_em')
      .eq('store_id', storeId)
      .gte('criado_em', since)
      .order('criado_em', { ascending: true })
      .limit(500);

    if (!messages || messages.length === 0) {
      return { ok: true, conversationsAnalyzed: 0 };
    }

    const { data: leads } = await supabase
      .from('bot_leads')
      .select('phone, status, status_comercial, interesse, valor_potencial, kanban_stage')
      .eq('store_id', storeId)
      .gte('atualizado_em', since);

    const convertedPhones = new Set(
      (leads || []).filter((l: { status: string }) => l.status === 'concluido').map((l: { phone: string }) => l.phone)
    );

    const convMap = new Map<string, Array<{ role: string; text: string; node: string }>>();
    for (const m of messages) {
      if (!convMap.has(m.phone)) convMap.set(m.phone, []);
      convMap.get(m.phone)!.push({
        role: m.direcao === 'entrada' ? 'cliente' : 'bot',
        text: (m.conteudo as string).slice(0, 200),
        node: (m.node as string) || '',
      });
    }

    const conversationSummaries: string[] = [];
    for (const [phone, turns] of convMap.entries()) {
      const converted = convertedPhones.has(phone);
      const preview = turns
        .slice(0, 8)
        .map(t => `[${t.role}]: ${t.text}`)
        .join('\n');
      conversationSummaries.push(
        `--- CONVERSA ${converted ? '✅ CONVERTEU' : '❌ não converteu'} ---\n${preview}`
      );
      if (conversationSummaries.length >= 30) break;
    }

    const categories = await loadStoreCategories(storeId).catch(() => [] as string[]);
    const { data: products } = await supabase
      .from('products')
      .select('name, category, price, stock')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .limit(20);

    const productList = (products || [])
      .map((p: { name: string; category: string; price: number }) => `${p.name} (${p.category}) - R$${p.price}`)
      .join('\n');

    const analysisPrompt = `
Você é um analista de vendas especialista em WhatsApp commerce.
Analise as conversas abaixo e extraia inteligência para melhorar as vendas desta loja.

PRODUTOS DA LOJA:
${productList || 'Não disponível'}

CATEGORIAS: ${categories.join(', ') || 'Não disponível'}

CONVERSAS DOS ÚLTIMOS 7 DIAS (${conversationSummaries.length} conversas):
${conversationSummaries.join('\n\n')}

Com base nestas conversas, responda APENAS com um JSON válido com esta estrutura:
{
  "business_context": "resumo do negócio e posicionamento em 2-3 frases",
  "catalog_summary": "o que a loja vende em 1-2 frases",
  "price_range": "faixa de preço predominante (ex: R$80 a R$500)",
  "customer_profile": "quem são os clientes, comportamento de compra em 2-3 frases",
  "weekly_top_queries": ["top 5 perguntas mais frequentes esta semana"],
  "weekly_objections": ["top 3 objeções mais comuns"],
  "closing_signals": ["top 4 frases/sinais que indicam que o cliente está pronto para comprar"],
  "successful_patterns": [
    { "pattern": "abordagem ou frase que funcionou", "context": "quando usar", "conversion_rate": 0.8 }
  ],
  "objection_map": {
    "objeção comum": "como responder que funcionou nesta loja"
  },
  "hot_products_now": ["produtos mais consultados esta semana"],
  "handoff_triggers": ["situações onde chamar humano aumenta a conversão"],
  "conversion_rate_week": 0.15
}

Responda APENAS com o JSON. Sem explicações, sem markdown, sem texto extra.
    `.trim();

    const result = await callGeminiAnalysis(analysisPrompt);
    if (!result) return { ok: false, conversationsAnalyzed: 0, error: 'IA não retornou análise' };

    let brain: Record<string, unknown>;
    try {
      const clean = result.replace(/```json|```/g, '').trim();
      brain = JSON.parse(clean);
    } catch {
      return { ok: false, conversationsAnalyzed: 0, error: 'Falha ao parsear resposta da IA' };
    }

    const { error: upsertError } = await supabase
      .from('store_brain')
      .upsert({
        store_id:               storeId,
        ...brain,
        last_analysis_at:       new Date().toISOString(),
        analysis_version:       ((brain.analysis_version as number) || 0) + 1,
        conversations_analyzed: messages.length,
        updated_at:             new Date().toISOString(),
      }, { onConflict: 'store_id' });

    if (upsertError) throw upsertError;

    clearBrainCache(storeId);

    return { ok: true, conversationsAnalyzed: convMap.size };

  } catch (err) {
    console.error('[AnalysisService] Error:', err);
    return { ok: false, conversationsAnalyzed: 0, error: (err as Error).message };
  }
}
