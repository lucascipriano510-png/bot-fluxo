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
  voiceProfile?:   StoreVoiceProfile;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
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

  return [
    `Você é o assistente de vendas da loja ${storeName}.`,
    '',
    'DADOS DA LOJA:',
    storeData,
    '',
    'REGRAS DE RESPOSTA (OBRIGATÓRIAS):',
    `- ${greetingRule}`,
    '- Respostas SEMPRE completas. NUNCA termine no meio de uma frase ou com vírgula.',
    '- Máximo 2 linhas. Seja direto, comercial e humano.',
    '- NUNCA use expressões como "não tenho essa informação" ou "não sei". Em vez disso, ofereça ajuda.',
    missingDataRule ? `- ${missingDataRule.replace(/\n/g, '\n- ')}` : '',
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
): Promise<string | null> {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents:          [{ role: 'user', parts: [{ text: message }] }],
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
      return await callGemini(message, createSystemPrompt(ctx, intentHint), key, model);
    }
    return null;
  } catch (err) {
    console.error('[AI Assist] Erro:', (err as Error).message);
    return null;
  }
}
