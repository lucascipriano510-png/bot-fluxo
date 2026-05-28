// ═══════════════════════════════════════════════════════════════════════════
//  aiAssistService — Camada de IA controlada para respostas conversacionais
//
//  Arquitetura:
//  - Quando o roteador fixo não consegue classificar uma mensagem com confiança,
//    o motor pode chamar aiAssist() para uma resposta contextualizada.
//  - O AI Assist opera com guardrails rígidos: nunca inventa produto, preço,
//    estoque, prazo, promoção ou disponibilidade sem dado real.
//  - Se não houver provider de IA configurado (AI_ASSIST_KEY não definida),
//    aiAssist() retorna null e o bot cai no fallback fixo.
//  - Nunca inserir API keys no código. Sempre ler de process.env.
//
//  Para ativar no futuro:
//  1. Defina AI_ASSIST_PROVIDER=openai|anthropic no ambiente de produção.
//  2. Defina AI_ASSIST_KEY com a chave do provider.
//  3. O sistema usará createSystemPrompt() para construir o contexto da loja.
// ═══════════════════════════════════════════════════════════════════════════

// ── Perfil de voz da loja — base para "treinamento" futuro ──────────────────
// Quando o painel permitir configurar o tom da loja, esses campos serão
// preenchidos pelo dono e usados no system prompt da IA.
export interface StoreVoiceProfile {
  tone:               'formal' | 'casual' | 'friendly' | 'commercial';
  greetingStyle:      string;  // ex: "curto e direto", "acolhedor com emoji"
  salesStyle:         string;  // ex: "consultivo", "direto ao ponto"
  objectionHandling:  string;  // ex: "sempre oferece alternativa", "não pressiona"
  closingStyle:       string;  // ex: "convida para WhatsApp", "agenda visita"
}

// ── Contexto seguro que a IA pode usar ──────────────────────────────────────
export interface AiAssistContext {
  storeName:    string;
  storePhone?:  string;
  greetingMsg?: string;
  voiceProfile?: StoreVoiceProfile;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ── Guardrails — o que a IA jamais pode fazer ────────────────────────────────
const GUARDRAILS = `
REGRAS RÍGIDAS (nunca violar):
- Nunca invente preço, valor ou promoção.
- Nunca invente estoque, disponibilidade ou prazo.
- Nunca invente produto ou serviço que não foi mencionado.
- Nunca confirme desconto sem dado real.
- Nunca use linguagem exclusiva de loja de roupas (peça, tamanho P/M/G) se não for o contexto.
- Se não souber a resposta, diga que vai verificar ou redirecione para atendente.
- Sempre conduza para catálogo, orçamento ou atendente humano quando necessário.
- Linguagem universal — funciona para qualquer negócio local.
`.trim();

// ── Monta system prompt para o provider de IA ───────────────────────────────
export function createSystemPrompt(ctx: AiAssistContext): string {
  const vp = ctx.voiceProfile;
  const tone = vp?.tone ?? 'friendly';
  const greetingStyle = vp?.greetingStyle ?? 'natural e acolhedor';
  const salesStyle = vp?.salesStyle ?? 'consultivo';

  return `Você é o assistente virtual da loja *${ctx.storeName}*.
Seu tom é ${tone}. Estilo de saudação: ${greetingStyle}. Estilo de vendas: ${salesStyle}.
${ctx.storePhone ? `WhatsApp da loja: ${ctx.storePhone}.` : ''}
${ctx.greetingMsg ? `Mensagem de saudação configurada: "${ctx.greetingMsg}".` : ''}

${GUARDRAILS}

Responda sempre em português brasileiro, de forma concisa (máximo 3 linhas).
Quando o cliente perguntar sobre algo que você não tem dados, redirecione com naturalidade.`;
}

// ── Função principal — retorna null se não houver IA configurada ─────────────
export async function aiAssist(
  _message: string,
  _ctx: AiAssistContext,
): Promise<string | null> {
  const provider = process.env.AI_ASSIST_PROVIDER;
  const key      = process.env.AI_ASSIST_KEY;

  // Sem provider configurado — retorna null, bot usa resposta fixa
  if (!provider || !key) return null;

  // Placeholder para integração futura com OpenAI/Anthropic/etc.
  // Exemplo de implementação Anthropic:
  //
  // const { Anthropic } = await import('@anthropic-ai/sdk');
  // const client = new Anthropic({ apiKey: key });
  // const systemPrompt = createSystemPrompt(_ctx);
  // const response = await client.messages.create({
  //   model: 'claude-haiku-4-5-20251001',
  //   max_tokens: 200,
  //   system: systemPrompt,
  //   messages: [{ role: 'user', content: _message }],
  // });
  // return response.content[0].type === 'text' ? response.content[0].text : null;

  return null;
}
