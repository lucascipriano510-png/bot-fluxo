import { FLOW_MAP, NodeId } from './flowMap';
import { BotSession, BotResponse } from '../types';
import { updateSession } from '../services/sessionService';
import { saveMensagem } from '../services/mensagemService';
import { registerLead } from '../services/leadService';
import { generateWhatsAppLink } from '../providers/messaging';

const LOJA_WHATSAPP = process.env.LOJA_WHATSAPP || '';
const LOJA_NOME     = process.env.LOJA_NOME     || 'nossa loja';

export async function processMessage(
  session: BotSession,
  messageText: string,
): Promise<BotResponse> {

  const currentNodeId = (session.current_node as NodeId) || 'INICIO';
  const currentNode   = FLOW_MAP[currentNodeId] || FLOW_MAP['INICIO'];
  const ctx: Record<string, string> = { ...session.context };

  // ── 1. Salva mensagem de entrada ──────────────────────────────────────────
  await saveMensagem({
    phone: session.phone,
    direcao: 'entrada',
    conteudo: messageText,
    node: currentNodeId,
  });

  // ── 2. Aplica ação do nó atual (captura dado da resposta recebida) ─────────
  if (currentNode.action === 'save_nome') {
    ctx.nome = messageText.trim().slice(0, 50);
  } else if (currentNode.action === 'save_tamanho') {
    const m = messageText.match(/\b(GG|G|M|P)\b/i) || messageText.match(/\b(3[5-9]|4[0-6])\b/);
    ctx.tamanho = m ? m[0].toUpperCase() : messageText.trim().slice(0, 10);
  } else if (currentNode.action === 'save_estilo') {
    const m = messageText.match(/b[aá]sica|polo|malha\s*premium|malha|jeans|tactel|moletom/i);
    ctx.estilo = m ? m[0].toLowerCase().trim() : messageText.trim().slice(0, 20);
  } else if (currentNode.action === 'save_cidade') {
    ctx.cidade = messageText.trim().slice(0, 40);
  }

  // ── 3. Decide próximo nó ──────────────────────────────────────────────────
  let nextNodeId: NodeId = currentNode.default || 'INICIO';

  if (currentNode.options) {
    for (const option of currentNode.options) {
      if (option.trigger.test(messageText)) {
        nextNodeId = option.next;
        if (option.data) Object.assign(ctx, option.data);
        break;
      }
    }
  }

  const nextNode = FLOW_MAP[nextNodeId] || FLOW_MAP['INICIO'];

  // ── 4. Executa ações do próximo nó ────────────────────────────────────────

  // Gera link WA para nós terminais
  if (nextNode.terminal) {
    const wamsg = ctx.nome
      ? `Olá! Sou ${ctx.nome}${ctx.interesse ? ` e me interessei por ${ctx.interesse}` : ''}. Vim pelo bot!`
      : `Olá! Vim pelo bot e preciso de ajuda.`;
    ctx.wa_link = generateWhatsAppLink(LOJA_WHATSAPP, wamsg);
  }

  // Registra/atualiza lead — só quando há dado de produto
  if (nextNode.action === 'register_lead' && (ctx.interesse || ctx.origem)) {
    const statusComercial = (ctx.status_comercial as 'QUENTE' | 'MORNO' | 'FRIO') || 'MORNO';
    await registerLead({
      phone: session.phone,
      nome:            ctx.nome,
      interesse:       ctx.interesse || ctx.origem,
      origem:          ctx.origem,
      tamanho:         ctx.tamanho,
      estilo:          ctx.estilo,
      cidade:          ctx.cidade,
      status_comercial: statusComercial,
      proxima_acao:    ctx.proxima_acao,
      status:          statusComercial === 'QUENTE' ? 'encaminhado' : 'qualificado',
      context:         ctx,
    });
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
