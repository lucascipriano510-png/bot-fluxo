// ═══════════════════════════════════════════════════════════════════════════
//  aiAssistService — Camada de IA controlada para respostas conversacionais
//
//  Provider atual: Gemini (Google Generative AI REST API)
//  Ativação: definir AI_ASSIST_PROVIDER=gemini e AI_ASSIST_KEY nas env vars.
//  Modelo padrão: AI_ASSIST_MODEL=gemini-1.5-flash
//
//  Guardrails: nunca inventa preço, estoque, produto, prazo, endereço ou promoção.
//  Quando não há dados, redireciona para atendimento — nunca diz "não sei".
//  API key NUNCA sai do backend — nunca exposta no frontend ou nos logs.
// ═══════════════════════════════════════════════════════════════════════════

// ── Perfil de voz da loja — base para personalização futura ─────────────────
export interface StoreVoiceProfile {
  tone:               'formal' | 'casual' | 'friendly' | 'commercial';
  greetingStyle:      string;
  salesStyle:         string;
  objectionHandling:  string;
  closingStyle:       string;
}

// ── Contexto seguro que a IA pode usar ──────────────────────────────────────
export interface AiAssistContext {
  storeName:       string;
  businessType?:   string;
  city?:           string;
  storePhone?:     string;
  openingHours?:   string;
  deliveryInfo?:   string;
  paymentInfo?:    string;
  greetingMsg?:    string;
  // Site Sensor — alimentado após scan controlado
  siteUrl?:        string;
  siteTitle?:      string;
  siteDescription?: string;
  siteSummary?:    string;
  voiceProfile?:        StoreVoiceProfile;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  storeCategories?:     string[];
  segmentInstructions?: string;
  storeBrain?:          string;
}

// ── Guardrails rígidos — nunca removíveis ────────────────────────────────────
const GUARDRAILS = `
GUARDRAILS (NUNCA VIOLAR):
- Nunca invente preço, valor, promoção ou desconto.
- Nunca invente estoque, disponibilidade ou prazo.
- Nunca invente produto, serviço, endereço ou horário.
- Para perguntas de produto ou serviço específico, direcione para o catálogo ou atendente.
- Nunca confirme disponibilidade sem dado real.
`.trim();

// ── Instruções por segmento de negócio ──────────────────────────────────────
export function buildSegmentInstructions(
  businessType?: string,
  categories?: string[],
): string {
  const catList = categories && categories.length > 0
    ? `\nO catálogo desta loja inclui: ${categories.slice(0, 15).join(', ')}.`
    : '';

  const type = (businessType || '').toLowerCase();

  if (type.includes('barbearia') || type.includes('salao') || type.includes('cabelo')) {
    return `Você é assistente de uma barbearia/salão. Quando o cliente perguntar sobre serviços, colete: qual serviço deseja, preferência de profissional (se houver), e melhor data/período. Nunca confirme disponibilidade de horário sem o operador verificar.${catList}`;
  }
  if (type.includes('lava') || type.includes('lavagem') || type.includes('automotiv')) {
    return `Você é assistente de um lava-jato/serviço automotivo. Colete: tipo de veículo, serviço desejado, e disponibilidade de data. Nunca confirme preço sem o operador verificar.${catList}`;
  }
  if (type.includes('clinica') || type.includes('medic') || type.includes('saude') || type.includes('odonto')) {
    return `Você é assistente de uma clínica/serviço de saúde. Seja atencioso e empático. Colete: tipo de consulta/serviço, preferência de data e período. Nunca forneça diagnósticos ou informações médicas. Sempre encaminhe para o profissional.${catList}`;
  }
  if (type.includes('pet') || type.includes('animal') || type.includes('veterinar')) {
    return `Você é assistente de um pet shop/clínica veterinária. Colete: tipo de animal, raça/porte quando relevante, serviço ou produto desejado. Quando for consulta veterinária, nunca forneça diagnósticos.${catList}`;
  }
  if (type.includes('agendamento') || type.includes('agenda') || type.includes('horario')) {
    return `Você é assistente de agendamento. Quando o cliente quiser marcar, colete: serviço desejado, data preferida, período (manhã/tarde/noite). Nunca confirme horário disponível sem o operador verificar.${catList}`;
  }
  if (type.includes('servico') || type.includes('serviço') || type.includes('orcamento') || type.includes('orçamento')) {
    return `Você é assistente de uma empresa de serviços. Quando o cliente pedir orçamento, colete: descrição do serviço, prazo desejado, e qualquer especificação relevante. Nunca confirme preço sem o operador avaliar.${catList}`;
  }
  if (type.includes('roupa') || type.includes('moda') || type.includes('outlet') || type.includes('varejo') || type.includes('loja')) {
    return `Você é assistente de uma loja de moda/varejo. Quando o cliente perguntar sobre produto, colete: categoria de interesse, tamanho que usa, e estilo preferido. Nunca confirme estoque sem verificar no catálogo.${catList}`;
  }

  return catList
    ? `Você é assistente desta empresa.${catList} Quando o cliente perguntar sobre produtos ou serviços, use essa lista para orientar a conversa.`
    : '';
}

// ── Instruções por intent — só incluídas quando relevante ───────────────────
const INTENT_INSTRUCTIONS: Record<string, string> = {
  complaint:         'O cliente está com um problema ou reclamação. Responda com empatia genuína. Peça para descrever o que aconteceu. Ofereça encaminhar para atendente se necessário. Nunca minimize o problema.',
  price_sensitivity: 'O cliente achou caro. Não entre em conflito. Reconheça a preocupação com preço. Pergunte qual é o orçamento disponível. Se souber de opções mais em conta pelo histórico, mencione.',
  gift:              'O cliente quer dar um presente. Conduza uma mini-consultoria: pergunte estilo, tamanho e faixa de preço da pessoa que vai receber. Use o que sabe da conversa para personalizar.',
  wholesale:         'O cliente quer comprar em atacado ou revender. Colete: produto de interesse, quantidade estimada e prazo. Informe que vai conectar com o time comercial.',
  new_arrivals:      'O cliente quer ver novidades. Se souber o que ele buscou antes pelo histórico, mencione que pode mostrar itens relacionados. Caso contrário, pergunte a categoria de interesse.',
  catalog:           'O cliente quer ver o catálogo ou os produtos. Pergunte o que ele está procurando de forma natural. Use o histórico para não repetir perguntas já feitas.',
  busca_item:        'O cliente está buscando um item ou serviço específico. Pergunte o que ele está procurando de forma natural. Use o histórico para não repetir perguntas já feitas.',
  delivery:          'O cliente perguntou sobre entrega mas não há informação cadastrada. Pergunte a cidade do cliente e informe que vai confirmar as opções de envio.',
  hours:             'O cliente perguntou sobre horário mas não há informação cadastrada. Peça para aguardar e ofereça conectar com um atendente para confirmar.',
  payment:           'O cliente perguntou sobre pagamento mas não há informação cadastrada. Pergunte o que ele quer comprar e informe que vai confirmar as formas de pagamento disponíveis.',
  exchange:          'O cliente perguntou sobre troca ou devolução mas não há política cadastrada. Peça para descrever a situação e ofereça conectar com um atendente.',
  location:          'O cliente perguntou sobre o endereço mas não há localização cadastrada. Ofereça conectar com um atendente para passar o endereço exato.',
  store_site:        'O cliente quer o link do site. Se siteUrl estiver disponível no contexto, compartilhe e ofereça ajuda por aqui também. Se não estiver, informe que vai confirmar e ofereça ajuda direta.',
};

// ── Monta system prompt seguro e contextualizado ────────────────────────────
export function createSystemPrompt(ctx: AiAssistContext, intentHint?: string): string {
  const storeName    = ctx.storeName || 'nossa loja';
  const isGreeting   = intentHint === 'greeting';

  // Dados disponíveis da loja — só inclui o que existe
  const storeData = [
    `Loja: ${storeName}`,
    ctx.businessType   ? `Tipo de negócio: ${ctx.businessType}`  : '',
    ctx.city           ? `Cidade: ${ctx.city}`                   : '',
    ctx.storePhone     ? `WhatsApp: ${ctx.storePhone}`           : '',
    ctx.openingHours   ? `Horário: ${ctx.openingHours}`          : '',
    ctx.deliveryInfo   ? `Entrega: ${ctx.deliveryInfo}`          : '',
    ctx.paymentInfo    ? `Pagamento: ${ctx.paymentInfo}`         : '',
    ctx.siteUrl        ? `Site: ${ctx.siteUrl}`                  : '',
    ctx.siteTitle      ? `Título do site: ${ctx.siteTitle}`      : '',
    ctx.siteDescription ? `Descrição do site: ${ctx.siteDescription}` : '',
    ctx.siteSummary    ? `Conteúdo do site (resumo):\n${ctx.siteSummary.slice(0, 800)}` : '',
  ].filter(Boolean).join('\n');

  // Instrução de saudação: espelha saudação de horário se presente na mensagem;
  // para saudações simples ("oi"), usa greetingMsg configurado; caso contrário, responde direto.
  const greetingRule = isGreeting && ctx.greetingMsg
    ? `Quando cumprimentar, use: "${ctx.greetingMsg}"`
    : 'Se a mensagem do cliente contiver "bom dia", "boa tarde" ou "boa noite", comece sua resposta com a mesma saudação. Caso contrário, NÃO comece com saudação — responda direto ao ponto.';

  // Instrução para dados ausentes
  const missingDataRule = [
    ctx.city         ? '' : 'Se perguntarem de qual cidade somos: "Me fala o que você procura que te ajudo."',
    ctx.deliveryInfo ? '' : 'Se perguntarem sobre entrega: "Posso confirmar isso com a loja. Me fala o que você quer comprar?"',
    ctx.paymentInfo  ? '' : 'Se perguntarem sobre pagamento: "Posso confirmar as formas de pagamento disponíveis. Quer que eu chame um atendente?"',
  ].filter(Boolean).join('\n');

  const segmentSection = ctx.segmentInstructions
    ? `\nINSTRUÇÕES DO SEGMENTO:\n${ctx.segmentInstructions}`
    : '';

  const brainSection = ctx.storeBrain ? `\n${ctx.storeBrain}` : '';

  const intentInstruction = intentHint && INTENT_INSTRUCTIONS[intentHint]
    ? `\nCONTEXTO DA MENSAGEM ATUAL:\n${INTENT_INSTRUCTIONS[intentHint]}`
    : '';

  return [
    `Você é o assistente de vendas da loja ${storeName}.`,
    '',
    'DADOS DA LOJA:',
    storeData,
    segmentSection,
    brainSection,
    '',
    'REGRAS DE RESPOSTA (OBRIGATÓRIAS):',
    `- ${greetingRule}`,
    '- Respostas SEMPRE completas. NUNCA termine no meio de uma frase ou com vírgula.',
    '- Máximo 2 linhas. Seja direto, comercial e humano.',
    '- NUNCA use expressões como "não tenho essa informação" ou "não sei". Em vez disso, ofereça ajuda.',
    missingDataRule ? `- ${missingDataRule.replace(/\n/g, '\n- ')}` : '',
    intentInstruction,
    '',
    GUARDRAILS,
  ].filter(s => s !== '').join('\n');
}

// ── Chamada à Gemini REST API ────────────────────────────────────────────────
async function callGemini(
  message: string,
  systemPrompt: string,
  key: string,
  model: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const contents = [
    ...(history ?? []).map(turn => ({
      role:  turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig:  { maxOutputTokens: 300, temperature: 0.5 },
  };

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8_000),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const json      = await resp.json() as Record<string, unknown>;
  const candidate = (json?.candidates as Array<Record<string, unknown>>)?.[0];
  const content   = candidate?.content as Record<string, unknown>;
  const parts     = content?.parts     as Array<Record<string, unknown>>;
  const text      = parts?.[0]?.text   as string | undefined;

  return text?.trim() || null;
}

// ── Teste de conexão ────────────────────────────────────────────────────────
export async function testAiConnection(): Promise<{ ok: boolean; reply?: string; error?: string; provider?: string; model?: string }> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  const model    = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';

  if (!provider || !key) {
    return { ok: false, error: 'IA não configurada. Defina AI_ASSIST_PROVIDER e AI_ASSIST_KEY nas variáveis de ambiente.' };
  }

  try {
    if (provider === 'gemini') {
      const reply = await callGemini(
        'Responda apenas: "IA Generativa funcionando corretamente."',
        'Você é um assistente de teste. Responda exatamente o que for pedido, em português.',
        key,
        model,
      );
      return { ok: true, reply: reply || 'Resposta vazia.', provider, model };
    }
    return { ok: false, error: `Provider "${provider}" não suportado. Use: gemini.` };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes('TimeoutError') || msg.includes('timeout')) {
      return { ok: false, error: 'Timeout: API não respondeu em 8s. Verifique a chave.', provider, model };
    }
    return { ok: false, error: msg, provider, model };
  }
}

// ── Função principal chamada pelo motor do bot ───────────────────────────────
export async function aiAssist(
  message: string,
  ctx: AiAssistContext,
  intentHint?: string,
): Promise<string | null> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  const model    = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';

  if (!provider || !key) return null;

  try {
    if (provider === 'gemini') {
      return await callGemini(message, createSystemPrompt(ctx, intentHint), key, model, ctx.conversationHistory);
    }
    return null;
  } catch (err) {
    console.error('[AI Assist] Erro:', (err as Error).message);
    return null;
  }
}
