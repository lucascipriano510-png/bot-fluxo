import { FLOW_MAP, NodeId } from './flowMap';
import { BotSession, BotResponse } from '../types';
import { updateSession } from '../services/sessionService';
import { saveMensagem } from '../services/mensagemService';
import { registerLead } from '../services/leadService';
import { generateWhatsAppLink } from '../providers/messaging';

const LOJA_WHATSAPP = process.env.LOJA_WHATSAPP || '';
const LOJA_NOME = process.env.LOJA_NOME || 'nossa loja';

export async function processMessage(
  session: BotSession,
  messageText: string,
): Promise<BotResponse> {

  const currentNodeId = (session.current_node as NodeId) || 'INICIO';
  const currentNode = FLOW_MAP[currentNodeId] || FLOW_MAP['INICIO'];
  const ctx: Record<string, string> = { ...session.context };

  // ── 1. Salva mensagem de entrada ──────────────────────────────────────────
  await saveMensagem({
    phone: session.phone,
    direcao: 'entrada',
    conteudo: messageText,
    node: currentNodeId,
  });

  // ── 2. Aplica ação do nó atual (captura dados da resposta recebida) ────────
  if (currentNode.action === 'save_name') {
    ctx.nome = messageText.trim();
  } else if (currentNode.action === 'save_interest') {
    ctx.interesse = messageText.trim();
  }

  // ── 3. Decide próximo nó ──────────────────────────────────────────────────
  let nextNodeId: NodeId = currentNode.default || 'INICIO';

  if (currentNode.options) {
    for (const option of currentNode.options) {
      if (option.trigger.test(messageText)) {
        nextNodeId = option.next;
        break;
      }
    }
  }

  const nextNode = FLOW_MAP[nextNodeId] || FLOW_MAP['INICIO'];

  // ── 4. Executa ações do próximo nó ────────────────────────────────────────
  if (nextNode.action === 'register_lead') {
    await registerLead({
      phone: session.phone,
      nome: ctx.nome,
      interesse: ctx.interesse,
      status: 'qualificado',
      context: ctx,
    });
  }

  if (nextNode.action === 'generate_wa_link' || nextNode.terminal) {
    const msg = ctx.nome
      ? `Olá! Sou ${ctx.nome}${ctx.interesse ? ` e me interessei por ${ctx.interesse}` : ''}. Vim pelo bot!`
      : `Olá! Vim pelo bot e preciso de ajuda.`;
    ctx.wa_link = generateWhatsAppLink(LOJA_WHATSAPP, msg);
  }

  // ── 5. Monta texto da resposta ────────────────────────────────────────────
  const rawMessage =
    typeof nextNode.message === 'function'
      ? nextNode.message(ctx)
      : nextNode.message;

  const text = rawMessage.replace('{wa_link}', ctx.wa_link || '');

  // ── 6. Define próximo estado (nó terminal reinicia em INICIO) ─────────────
  const finalNode: NodeId = nextNode.terminal ? 'INICIO' : nextNodeId;

  // ── 7. Persiste sessão atualizada ─────────────────────────────────────────
  await updateSession(session.phone, finalNode, ctx);

  // ── 8. Salva mensagem de saída ────────────────────────────────────────────
  await saveMensagem({
    phone: session.phone,
    direcao: 'saida',
    conteudo: text,
    node: nextNodeId,
  });

  return { text, nextNode: finalNode, context: ctx };
}
