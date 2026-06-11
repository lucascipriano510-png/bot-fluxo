import { supabase } from '../lib/supabase';

const KANBAN_STAGES = ['novo', 'interessado', 'escolhendo', 'carrinho', 'pagamento', 'finalizado'];

export interface LeadIntelligenceResult {
  temperatura:            'quente' | 'morno' | 'frio';
  score:                  number;
  resumo:                 string;
  proxima_acao:           string;
  intencao_principal:     string;
  kanban_coluna_sugerida: string;
  confianca:              number;
}

async function callGemini(prompt: string): Promise<string | null> {
  const key   = process.env.AI_ASSIST_KEY || '';
  const model = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';
  if (!key) { console.warn('[Intelligence] AI_ASSIST_KEY não definido.'); return null; }

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents:        [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
  };

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

export async function analyzeLeadIntelligence(leadId: string): Promise<LeadIntelligenceResult | null> {
  const { data: lead } = await supabase
    .from('bot_leads')
    .select('phone, store_id, nome')
    .eq('id', leadId)
    .single();

  if (!lead) return null;

  // Busca mensagens WA (via lead_id)
  const { data: waMsgs } = await supabase
    .from('wa_messages')
    .select('direction, text, timestamp')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: true })
    .limit(30);

  let messages: Array<{ direction: string; text: string }> = waMsgs || [];

  // Fallback: bot_mensagens via phone
  if (messages.length === 0) {
    const { data: botMsgs } = await supabase
      .from('bot_mensagens')
      .select('direcao, conteudo, criado_em')
      .eq('phone', lead.phone)
      .eq('store_id', lead.store_id)
      .order('criado_em', { ascending: true })
      .limit(30);

    messages = (botMsgs || []).map(m => ({
      direction: m.direcao === 'saida' ? 'out' : 'in',
      text:      m.conteudo,
    }));
  }

  if (messages.length === 0) return null;

  const conversa = messages
    .map(m => `${m.direction === 'out' ? 'Loja' : 'Cliente'}: ${m.text}`)
    .join('\n');

  const prompt = `Você é um analista de CRM especializado em e-commerce de moda no Brasil.
Analise esta conversa de WhatsApp e retorne APENAS um JSON válido sem markdown.

Conversa:
${conversa}

Retorne este JSON exato:
{
"temperatura": "quente|morno|frio",
"score": número de 0 a 100,
"resumo": "resumo em 2-3 frases do estado atual deste lead",
"proxima_acao": "ação comercial específica e concreta recomendada",
"intencao_principal": "interesse_produto|pergunta_preco|reclamacao|abandono|pronto_comprar|primeiro_contato|sem_intencao_clara",
"kanban_coluna_sugerida": "uma dessas: novo, interessado, escolhendo, carrinho, pagamento, finalizado",
"confianca": número de 0 a 1
}

Critérios:
- quente (score 70-100): interesse claro, perguntou preço/tamanho/prazo, quer comprar, pediu link
- morno (score 30-69): iniciou conversa, pediu info genérica, sem intenção clara
- frio (score 0-29): não respondeu, conversa parada >48h, sem interesse, 1 mensagem só`;

  const raw = await callGemini(prompt);
  if (!raw) return null;

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result  = JSON.parse(cleaned) as LeadIntelligenceResult;

    if (!['quente', 'morno', 'frio'].includes(result.temperatura)) result.temperatura = 'frio';
    if (!KANBAN_STAGES.includes(result.kanban_coluna_sugerida))     result.kanban_coluna_sugerida = 'novo';
    result.score     = Math.max(0, Math.min(100, result.score || 0));
    result.confianca = Math.max(0, Math.min(1, result.confianca || 0));

    return result;
  } catch {
    return null;
  }
}

export async function analyzeSingleLead(leadId: string): Promise<LeadIntelligenceResult | null> {
  const result = await analyzeLeadIntelligence(leadId);
  if (!result) return null;

  const now = new Date().toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: lead } = await supabase
    .from('bot_leads')
    .select('kanban_stage, kanban_movido_manualmente_em')
    .eq('id', leadId)
    .single();

  const canAutoMove =
    !lead?.kanban_movido_manualmente_em ||
    lead.kanban_movido_manualmente_em < twoHoursAgo;

  const updates: Record<string, unknown> = {
    ai_score:            result.score,
    ai_resumo:           result.resumo,
    ai_intencao:         result.intencao_principal,
    ai_proxima_acao:     result.proxima_acao,
    ai_temperatura:      result.temperatura,
    ai_kanban_sugerida:  result.kanban_coluna_sugerida,
    ai_confianca:        result.confianca,
    ai_analisado_em:     now,
  };

  if (canAutoMove && result.kanban_coluna_sugerida !== lead?.kanban_stage) {
    updates.kanban_stage        = result.kanban_coluna_sugerida;
    updates.kanban_movido_por   = 'ia';
    updates.kanban_movimento_log = `Movido por IA: ${result.intencao_principal} (score ${result.score})`;
  }

  await supabase.from('bot_leads').update(updates).eq('id', leadId);
  return result;
}

export async function processAllLeads(storeId: string): Promise<{ processed: number; errors: number; total: number }> {
  const { data: leads } = await supabase
    .from('bot_leads')
    .select('id')
    .eq('store_id', storeId)
    .not('last_message_at', 'is', null);

  if (!leads || leads.length === 0) return { processed: 0, errors: 0, total: 0 };

  let processed = 0;
  let errors    = 0;
  const total   = leads.length;

  for (let i = 0; i < leads.length; i += 5) {
    const batch = leads.slice(i, i + 5);
    await Promise.all(batch.map(async lead => {
      try {
        await analyzeSingleLead(lead.id);
        processed++;
        console.log(`[Intelligence] ${processed}/${total} — ${lead.id}`);
      } catch {
        errors++;
      }
    }));
  }

  return { processed, errors, total };
}

export async function processNewLeads(storeId: string): Promise<{ processed: number }> {
  const { data: leads } = await supabase
    .from('bot_leads')
    .select('id, ai_analisado_em, last_message_at')
    .eq('store_id', storeId)
    .not('last_message_at', 'is', null);

  if (!leads) return { processed: 0 };

  const toProcess = leads.filter(l =>
    !l.ai_analisado_em || l.last_message_at > l.ai_analisado_em,
  );

  let processed = 0;
  for (let i = 0; i < toProcess.length; i += 5) {
    const batch = toProcess.slice(i, i + 5);
    await Promise.all(batch.map(async lead => {
      try { await analyzeSingleLead(lead.id); processed++; } catch (_) {}
    }));
  }

  if (processed > 0) console.log(`[Intelligence] Job 30min: ${processed} leads re-analisados.`);
  return { processed };
}

// UI a implementar no P12
export async function suggestReply(leadId: string, contexto?: string): Promise<string[] | null> {
  const { data: lead } = await supabase
    .from('bot_leads')
    .select('ai_resumo, ai_intencao, ai_proxima_acao')
    .eq('id', leadId)
    .single();

  const { data: msgs } = await supabase
    .from('wa_messages')
    .select('direction, text')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: false })
    .limit(10);

  const ultimas = (msgs || []).reverse()
    .map(m => `${m.direction === 'out' ? 'Loja' : 'Cliente'}: ${m.text}`)
    .join('\n');

  const prompt = `Você é assistente de vendas de loja de moda brasileira no WhatsApp.
Tom: informal mas profissional. Sem emojis excessivos.
Contexto: ${lead?.ai_resumo || ''}
Intenção: ${lead?.ai_intencao || ''}
Próxima ação: ${lead?.ai_proxima_acao || ''}
${contexto ? `Extra: ${contexto}` : ''}
Últimas mensagens:
${ultimas}
Gere 3 opções de resposta. Retorne JSON: { "opcoes": ["resp1","resp2","resp3"] }`;

  const raw = await callGemini(prompt);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned).opcoes || null;
  } catch { return null; }
}
