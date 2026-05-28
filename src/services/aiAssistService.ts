// ═══════════════════════════════════════════════════════════════════════════
//  aiAssistService — Camada de IA controlada para respostas conversacionais
//
//  Provider atual: Gemini (Google Generative AI REST API)
//  Ativação: definir AI_ASSIST_PROVIDER=gemini e AI_ASSIST_KEY nas env vars.
//  Modelo padrão: AI_ASSIST_MODEL=gemini-1.5-flash
//
//  Guardrails: nunca inventa preço, estoque, produto, prazo ou promoção.
//  Quando não há dados, redireciona para catálogo, orçamento ou humano.
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
  storeName:    string;
  storePhone?:  string;
  greetingMsg?: string;
  voiceProfile?: StoreVoiceProfile;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ── Guardrails — embutidos no system prompt, nunca removíveis ────────────────
const GUARDRAILS = `
REGRAS OBRIGATÓRIAS (nunca violar):
- Nunca invente preço, valor ou promoção.
- Nunca invente estoque, disponibilidade ou prazo.
- Nunca invente produto ou serviço sem dado real.
- Nunca confirme desconto sem informação concreta.
- Se não souber a resposta, diga que vai verificar ou redirecione para um atendente.
- Sempre conduza para catálogo, orçamento ou atendente quando necessário.
- Linguagem universal — funciona para qualquer negócio local.
- Responda sempre em português brasileiro, máximo 3 linhas.
`.trim();

// ── Monta system prompt seguro para o provider de IA ────────────────────────
export function createSystemPrompt(ctx: AiAssistContext): string {
  const vp   = ctx.voiceProfile;
  const tone = vp?.tone ?? 'friendly';

  return [
    `Você é o assistente virtual de *${ctx.storeName}*.`,
    `Tom: ${tone}.`,
    ctx.storePhone ? `WhatsApp da loja: ${ctx.storePhone}.` : '',
    ctx.greetingMsg ? `Saudação padrão: "${ctx.greetingMsg}".` : '',
    '',
    GUARDRAILS,
  ].filter(Boolean).join('\n');
}

// ── Chamada direta à Gemini REST API ────────────────────────────────────────
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
    generationConfig:  { maxOutputTokens: 200, temperature: 0.7 },
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

// ── Teste de conexão — usado pelo endpoint /api/integrations/ai/test ────────
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
): Promise<string | null> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  const model    = process.env.AI_ASSIST_MODEL || 'gemini-1.5-flash';

  if (!provider || !key) return null;

  try {
    if (provider === 'gemini') {
      return await callGemini(message, createSystemPrompt(ctx), key, model);
    }
    return null;
  } catch (err) {
    console.error('[AI Assist] Erro:', (err as Error).message);
    return null;
  }
}
