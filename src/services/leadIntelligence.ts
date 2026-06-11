import { supabase } from '../lib/supabase';
import { SALES_BRAIN_PROMPT } from '../config/salesBrain';

const KANBAN_STAGES = ['novo', 'interessado', 'escolhendo', 'carrinho', 'pagamento', 'finalizado'];

// Normaliza os nomes de coluna que o Gemini pode retornar para os IDs reais
function normalizeKanbanStage(raw: string): string {
  const map: Record<string, string> = {
    'novo lead': 'novo', 'new lead': 'novo',
    'interessado': 'interessado',
    'escolhendo': 'escolhendo',
    'carrinho montado': 'carrinho', 'carrinho': 'carrinho',
    'aguardando pgto': 'pagamento', 'pagamento': 'pagamento',
    'fechado': 'finalizado', 'finalizado': 'finalizado',
    'perdido': 'novo', // não existe no sistema, mantém na entrada
  };
  return map[raw.toLowerCase().trim()] || (KANBAN_STAGES.includes(raw) ? raw : 'novo');
}

export interface LeadIntelligenceResult {
  temperatura:            'quente' | 'morno' | 'frio';
  score:                  number;
  resumo:                 string;
  proxima_acao:           string;
  intencao_principal:     string;
  kanban_coluna_sugerida: string;
  urgencia:               'alta' | 'media' | 'baixa';
  confianca:              number;
}

const FALLBACK_NO_MESSAGES: LeadIntelligenceResult = {
  temperatura:            'frio',
  score:                  0,
  resumo:                 'Sem histórico de conversa disponível.',
  proxima_acao:           'Iniciar contato via WhatsApp.',
  intencao_principal:     'sem_intencao_clara',
  urgencia:               'baixa',
  kanban_coluna_sugerida: 'novo',
  confianca:              1,
};

async function callGemini(prompt: string): Promise<string | null> {
  const key   = process.env.AI_ASSIST_KEY || '';
  const model = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';

  if (!key) {
    console.error('[Intelligence] ERRO: AI_ASSIST_KEY não definida. Configure no Render → Environment.');
    return null;
  }

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents:         [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 600, temperature: 0 },
  };

  try {
    console.log(`[Intelligence] Chamando Gemini (modelo: ${model})...`);
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      console.error(`[Intelligence] Gemini HTTP ${resp.status}: ${errBody}`);
      return null;
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    if (!text) {
      console.error('[Intelligence] Gemini retornou resposta vazia:', JSON.stringify(data));
    }
    return text;
  } catch (err) {
    console.error('[Intelligence] Erro na chamada ao Gemini:', err);
    return null;
  }
}

export async function analyzeLeadIntelligence(leadId: string): Promise<LeadIntelligenceResult> {
  console.log(`[Intelligence] Iniciando análise do lead: ${leadId}`);

  // 1. Buscar dados do lead
  const { data: lead, error: leadErr } = await supabase
    .from('bot_leads')
    .select('phone, store_id, nome')
    .eq('id', leadId)
    .single();

  if (leadErr || !lead) {
    console.error(`[Intelligence] Lead não encontrado (${leadId}):`, leadErr);
    return FALLBACK_NO_MESSAGES;
  }

  console.log(`[Intelligence] Lead: ${lead.nome || lead.phone}`);

  // 2. Buscar mensagens WA por lead_id
  const { data: waMsgs, error: waErr } = await supabase
    .from('wa_messages')
    .select('direction, text, timestamp')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: true })
    .limit(30);

  if (waErr) console.error(`[Intelligence] Erro ao buscar wa_messages:`, waErr);
  let messages: Array<{ direction: string; text: string }> = waMsgs || [];
  console.log(`[Intelligence] wa_messages (lead_id): ${messages.length} mensagens`);

  // 3. Fallback: wa_messages por phone + store_id
  if (messages.length === 0) {
    const { data: waMsgsByPhone, error: waPhoneErr } = await supabase
      .from('wa_messages')
      .select('direction, text, timestamp')
      .eq('store_id', lead.store_id)
      .eq('phone', lead.phone)
      .order('timestamp', { ascending: true })
      .limit(30);

    if (waPhoneErr) console.error(`[Intelligence] Erro ao buscar wa_messages por phone:`, waPhoneErr);
    messages = waMsgsByPhone || [];
    console.log(`[Intelligence] wa_messages (phone): ${messages.length} mensagens`);
  }

  // 4. Fallback: bot_mensagens
  if (messages.length === 0) {
    const { data: botMsgs, error: botErr } = await supabase
      .from('bot_mensagens')
      .select('direcao, conteudo, criado_em')
      .eq('phone', lead.phone)
      .eq('store_id', lead.store_id)
      .order('criado_em', { ascending: true })
      .limit(30);

    if (botErr) console.error(`[Intelligence] Erro ao buscar bot_mensagens:`, botErr);
    messages = (botMsgs || []).map(m => ({
      direction: m.direcao === 'saida' ? 'out' : 'in',
      text:      m.conteudo,
    }));
    console.log(`[Intelligence] bot_mensagens: ${messages.length} mensagens`);
  }

  // 5. Nenhuma mensagem — salva fallback e retorna
  if (messages.length === 0) {
    console.log(`[Intelligence] Nenhuma mensagem encontrada para o lead ${leadId} — salvando fallback.`);
    return FALLBACK_NO_MESSAGES;
  }

  // 6. Montar conversa e calcular tempo desde última mensagem do cliente
  const msgsComTs = messages as Array<{ direction: string; text: string; timestamp?: string }>;
  const ultimaDoCliente = [...msgsComTs]
    .filter(m => m.direction === 'in' && m.timestamp)
    .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())[0];
  const horasDesdeUltimaMensagem = ultimaDoCliente?.timestamp
    ? Math.floor((Date.now() - new Date(ultimaDoCliente.timestamp).getTime()) / 3_600_000)
    : 999;

  const conversa = messages
    .map(m => `${m.direction === 'out' ? 'Loja' : 'Cliente'}: ${m.text}`)
    .join('\n');

  console.log(`[Intelligence] Conversa montada (${messages.length} msgs, ${horasDesdeUltimaMensagem}h desde última msg do cliente)`);
  console.log(`[Intelligence] Brain ativo: ${SALES_BRAIN_PROMPT.slice(0, 80).replace(/\n/g, ' ')}...`);

  const prompt = `${SALES_BRAIN_PROMPT}

═══════════════════════════════════
TAREFA
═══════════════════════════════════

Analise a conversa abaixo de uma loja de moda brasileira no WhatsApp.
Aplique todo o seu conhecimento de vendas e retorne SOMENTE um JSON válido,
sem markdown, sem explicações, sem texto antes ou depois.

CONVERSA:
${conversa}

TEMPO DESDE ÚLTIMA MENSAGEM DO CLIENTE: ${horasDesdeUltimaMensagem}h

Retorne este JSON exato (sem markdown, sem blocos de código):
{"temperatura":"frio","score":0,"resumo":"","proxima_acao":"","intencao_principal":"sem_intencao_clara","kanban_coluna_sugerida":"novo","urgencia":"baixa","confianca":0.5}

Valores válidos para kanban_coluna_sugerida: novo, interessado, escolhendo, carrinho, pagamento, finalizado
Valores válidos para intencao_principal: primeiro_contato, reconhecimento_anuncio, pesquisa_produto, avaliacao_preco, intencao_compra, fechamento, abandono, reclamacao, retorno
Valores válidos para urgencia: alta, media, baixa`;

  // 7. Chamar Gemini
  const raw = await callGemini(prompt);
  if (!raw) {
    console.error(`[Intelligence] Gemini não retornou dados para o lead ${leadId}`);
    return FALLBACK_NO_MESSAGES;
  }

  console.log(`[Intelligence] Resposta bruta do Gemini: ${raw.slice(0, 200)}`);

  // 8. Parse do JSON
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(cleaned) as LeadIntelligenceResult;

    // Normalizar e validar
    if (!['quente', 'morno', 'frio'].includes(result.temperatura))   result.temperatura = 'frio';
    if (!['alta', 'media', 'baixa'].includes(result.urgencia))       result.urgencia    = 'baixa';
    result.kanban_coluna_sugerida = normalizeKanbanStage(result.kanban_coluna_sugerida || '');
    result.score     = Math.max(0, Math.min(100, Number(result.score) || 0));
    result.confianca = Math.max(0, Math.min(1,   Number(result.confianca) || 0.5));
    if (!result.resumo)       result.resumo       = 'Análise concluída.';
    if (!result.proxima_acao) result.proxima_acao = 'Manter contato e acompanhar interesse.';

    console.log(`[Intelligence] Parse OK — score: ${result.score}, temp: ${result.temperatura}`);
    return result;
  } catch (parseErr) {
    console.error(`[Intelligence] Erro ao fazer parse do JSON (lead ${leadId}):`, parseErr);
    console.error(`[Intelligence] Raw Gemini response: ${raw}`);
    return FALLBACK_NO_MESSAGES;
  }
}

export async function analyzeSingleLead(leadId: string): Promise<LeadIntelligenceResult> {
  const result = await analyzeLeadIntelligence(leadId);
  const now    = new Date().toISOString();

  const { data: lead, error: leadErr } = await supabase
    .from('bot_leads')
    .select('kanban_stage, kanban_movido_manualmente_em')
    .eq('id', leadId)
    .single();

  if (leadErr) console.error(`[Intelligence] Erro ao buscar kanban_stage do lead ${leadId}:`, leadErr);

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const canAutoMove =
    !lead?.kanban_movido_manualmente_em ||
    lead.kanban_movido_manualmente_em < twoHoursAgo;

  const updates: Record<string, unknown> = {
    ai_score:           result.score,
    ai_resumo:          result.resumo,
    ai_intencao:        result.intencao_principal,
    ai_proxima_acao:    result.proxima_acao,
    ai_temperatura:     result.temperatura,
    ai_kanban_sugerida: result.kanban_coluna_sugerida,
    ai_urgencia:        result.urgencia,
    ai_confianca:       result.confianca,
    ai_analisado_em:    now,
  };

  if (canAutoMove && result.kanban_coluna_sugerida !== lead?.kanban_stage) {
    updates.kanban_stage         = result.kanban_coluna_sugerida;
    updates.kanban_movido_por    = 'ia';
    updates.kanban_movimento_log = `Movido por IA: ${result.intencao_principal} (score ${result.score})`;
    console.log(`[Intelligence] Kanban: ${lead?.kanban_stage} → ${result.kanban_coluna_sugerida}`);
  }

  const { error: updateErr } = await supabase
    .from('bot_leads')
    .update(updates)
    .eq('id', leadId);

  if (updateErr) {
    console.error(`[Intelligence] Erro ao salvar análise no Supabase (lead ${leadId}):`, updateErr);
  } else {
    console.log(`[Intelligence] Lead ${leadId} atualizado com sucesso.`);
  }

  return result;
}

export async function processAllLeads(storeId: string): Promise<{ processed: number; errors: number; total: number }> {
  console.log(`[Intelligence] processAllLeads iniciado para store: ${storeId}`);

  // Busca TODOS os leads da loja (não só os com last_message_at)
  const { data: leads, error } = await supabase
    .from('bot_leads')
    .select('id')
    .eq('store_id', storeId);

  if (error) { console.error('[Intelligence] Erro ao buscar leads:', error); return { processed: 0, errors: 0, total: 0 }; }
  if (!leads || leads.length === 0) { console.log('[Intelligence] Nenhum lead encontrado.'); return { processed: 0, errors: 0, total: 0 }; }

  let processed = 0;
  let errors    = 0;
  const total   = leads.length;
  console.log(`[Intelligence] Total de leads a processar: ${total}`);

  for (let i = 0; i < leads.length; i += 5) {
    const batch = leads.slice(i, i + 5);
    await Promise.all(batch.map(async lead => {
      try {
        await analyzeSingleLead(lead.id);
        processed++;
        console.log(`[Intelligence] Progresso: ${processed}/${total}`);
      } catch (err) {
        errors++;
        console.error(`[Intelligence] Erro no lead ${lead.id}:`, err);
      }
    }));
  }

  console.log(`[Intelligence] processAllLeads concluído: ${processed} OK, ${errors} erros.`);
  return { processed, errors, total };
}

export async function processNewLeads(storeId: string): Promise<{ processed: number }> {
  console.log('[Intelligence] Job 30min: verificando leads com mensagens novas...');

  const { data: leads } = await supabase
    .from('bot_leads')
    .select('id, ai_analisado_em, last_message_at')
    .eq('store_id', storeId);

  if (!leads) return { processed: 0 };

  const toProcess = leads.filter(l =>
    !l.ai_analisado_em ||
    (l.last_message_at && l.last_message_at > l.ai_analisado_em),
  );

  if (toProcess.length === 0) { console.log('[Intelligence] Nenhum lead novo para re-analisar.'); return { processed: 0 }; }

  console.log(`[Intelligence] Re-analisando ${toProcess.length} leads com atividade nova.`);
  let processed = 0;

  for (let i = 0; i < toProcess.length; i += 5) {
    const batch = toProcess.slice(i, i + 5);
    await Promise.all(batch.map(async lead => {
      try { await analyzeSingleLead(lead.id); processed++; } catch (err) {
        console.error(`[Intelligence] Erro no job lead ${lead.id}:`, err);
      }
    }));
  }

  console.log(`[Intelligence] Job concluído: ${processed} leads re-analisados.`);
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
Retorne SOMENTE o JSON: {"opcoes":["resp1","resp2","resp3"]}`;

  const raw = await callGemini(prompt);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned).opcoes || null;
  } catch { return null; }
}
