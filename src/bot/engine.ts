import { FLOW_MAP, NodeId } from './flowMap';
import { BotSession, BotResponse } from '../types';
import { updateSession } from '../services/sessionService';
import { saveMensagem } from '../services/mensagemService';
import { registerLead } from '../services/leadService';
import { generateWhatsAppLink } from '../providers/messaging';
import { isOptedOut, registerOptOut, removeOptOut } from '../services/optoutService';
import { isBusinessHours, openingTimeStr } from '../utils/businessHours';
import { loadFlowConfig, triggerToRegex } from '../services/flowConfigService';
import { getStoreById } from '../services/storeService';
import {
  detectProductQuery,
  logInventoryQuery,
} from '../inventory/inventoryBridge';
import {
  findOffersWithFallback,
  formatFallbackResponse,
  buildOfferFilters,
} from '../catalog/catalogBridge';
import { detectIntent } from '../services/intentService';
import { handleIntent } from '../services/chatBrainService';
import { getRuntimeSettings } from '../services/settingsService';

function estimateValue(_ctx: Record<string, string>): number {
  return 100;
}

const OPTOUT_TRIGGER = /\b(parar|stop|sair|cancelar|n[aã]o quero|remover|descadastrar|opt.?out)\b/i;
const REOPT_TRIGGER  = /\b(quero receber|ativar|retomar|voltar|continuar|ol[aá]|oi\b)/i;

export async function processMessage(
  session: BotSession,
  messageText: string,
): Promise<BotResponse> {

  // Contexto da loja — fonte de verdade é sempre session.store_id (UUID)
  const storeId  = session.store_id;
  const storeCtx = await getStoreById(storeId);

  // ── PRÉ-CHECAGEM 0: Bot ativo ─────────────────────────────────────────────
  const rtSettings = await getRuntimeSettings(storeId);
  if (!rtSettings.bot_ativo) {
    return { text: '', nextNode: session.current_node || 'INICIO', context: session.context };
  }

  // ── PRÉ-CHECAGEM 1: Opt-out / LGPD ───────────────────────────────────────
  if (OPTOUT_TRIGGER.test(messageText)) {
    await registerOptOut(storeId, session.phone);
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: 'OPTOUT' });
    const msgFn = FLOW_MAP['OPTOUT'].message;
    const reply = typeof msgFn === 'function' ? msgFn({ _storeName: storeCtx.name }) : msgFn as string;
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida', conteudo: reply, node: 'OPTOUT' });
    return { text: reply, nextNode: 'INICIO', context: {} };
  }

  // ── PRÉ-CHECAGEM 2: Usuário optado-out ───────────────────────────────────
  const optedOut = await isOptedOut(storeId, session.phone);
  if (optedOut) {
    if (REOPT_TRIGGER.test(messageText)) {
      await removeOptOut(storeId, session.phone);
    } else {
      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: 'OPTOUT' });
      const reply = `Você optou por não receber mensagens automáticas. 🔕\n\nPara voltar a interagir, basta dizer *"oi"* e começamos de novo! 😊`;
      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida', conteudo: reply, node: 'OPTOUT' });
      return { text: reply, nextNode: 'INICIO', context: {} };
    }
  }

  // ── PRÉ-CHECAGEM 3: Fora do horário (abertura de conversa) ───────────────
  if (session.current_node === 'INICIO' && !isBusinessHours(rtSettings)) {
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: 'FORA_HORARIO' });
    const ctx = { _abertura: openingTimeStr(rtSettings), _storeName: storeCtx.name };
    const msgFn = FLOW_MAP['FORA_HORARIO'].message;
    const reply = typeof msgFn === 'function' ? msgFn(ctx) : msgFn as string;
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida', conteudo: reply, node: 'FORA_HORARIO' });
    return { text: reply, nextNode: 'INICIO', context: session.context };
  }

  // ─────────────────────────────────────────────────────────────────────────
  const flowConfig = await loadFlowConfig(storeId);

  const currentNodeId = (session.current_node as NodeId) || 'INICIO';
  const currentNode   = FLOW_MAP[currentNodeId] || FLOW_MAP['INICIO'];

  // Injeta contexto da loja para uso nos templates de mensagem
  const ctx: Record<string, string> = {
    ...session.context,
    _storeName: storeCtx.name,
    _wa_loja:   storeCtx.whatsappNumber,
    _saudacao:  rtSettings.saudacao,
  };

  // ── PRÉ-CHECAGEM 4: Roteamento por intenção + catálogo ──────────────────
  // Detecta intenção antes de buscar catálogo para evitar buscas desnecessárias
  // em saudações, pedidos de atendente e orçamentos.
  const intentResult = detectIntent(messageText);

  // Intenções que nunca devem acionar busca de catálogo
  const NON_CATALOG = ['greeting', 'thanks', 'farewell', 'orcamento', 'compra', 'humano'];

  if (!NON_CATALOG.includes(intentResult.intent)) {
    const rawFilters = detectProductQuery(messageText);
    if (rawFilters) {
      const offerFilters                 = buildOfferFilters(storeId, rawFilters);
      const { offers, matched, dropped } = await findOffersWithFallback(offerFilters);
      const reply                        = formatFallbackResponse(offers, offerFilters, matched, dropped);
      logInventoryQuery(storeId, session.phone, messageText, rawFilters, offers.length, reply);

      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: reply,       node: 'CATALOG' });

      return { text: reply, nextNode: currentNodeId, context: ctx };
    }
  }

  // ── PRÉ-CHECAGEM 5: Camada cerebral (reutiliza intenção já detectada) ────
  const brainResult = handleIntent(messageText, intentResult, ctx, currentNodeId);
  if (brainResult) {
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText,      node: currentNodeId });
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: brainResult.reply, node: 'BRAIN' });
    return {
      text:           brainResult.reply,
      nextNode:       currentNodeId,
      context:        ctx,
      detectedIntent: brainResult.detectedIntent,
      confidence:     brainResult.confidence,
    };
  }

  const currentCfg = flowConfig.get(currentNodeId);
  const effectiveOptions = currentCfg?.options
    ? currentCfg.options.map(o => ({
        trigger: triggerToRegex(o.trigger),
        next: o.next as NodeId,
        data: o.data,
      }))
    : currentNode.options;
  const effectiveDefault = (currentCfg?.default_next as NodeId) || currentNode.default || 'INICIO';

  // ── 1. Salva mensagem de entrada ──────────────────────────────────────────
  await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });

  // ── 2. Aplica ação de captura do nó atual ─────────────────────────────────
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
  } else if (currentNode.action === 'save_numero_pedido') {
    const m = messageText.match(/#?\b([A-Za-z]*\d{4,})\b/);
    ctx.numero_pedido = m ? m[1] : messageText.trim().slice(0, 20);
  }

  // ── 3. Decide próximo nó ─────────────────────────────────────────────────
  let nextNodeId: NodeId = effectiveDefault;

  if (effectiveOptions) {
    for (const option of effectiveOptions) {
      if (option.trigger.test(messageText)) {
        nextNodeId = option.next;
        if (option.data) Object.assign(ctx, option.data);
        break;
      }
    }
  }

  const nextNode = FLOW_MAP[nextNodeId] || FLOW_MAP['INICIO'];

  // ── 4. Executa ações do próximo nó ────────────────────────────────────────
  if (nextNode.terminal) {
    const wamsg = ctx.nome
      ? `Olá! Sou ${ctx.nome}${ctx.interesse ? ` e me interessei por ${ctx.interesse}` : ''}. Vim pelo bot!`
      : `Olá! Vim pelo bot e preciso de ajuda.`;
    ctx.wa_link = generateWhatsAppLink(storeCtx.whatsappNumber, wamsg);
  }

  if (nextNode.action === 'register_lead' && (ctx.interesse || ctx.origem)) {
    const statusComercial = (ctx.status_comercial as 'QUENTE' | 'MORNO' | 'FRIO') || 'MORNO';
    await registerLead({
      store_id:         storeId,
      phone:            session.phone,
      nome:             ctx.nome,
      interesse:        ctx.interesse || ctx.origem,
      origem:           ctx.origem,
      tamanho:          ctx.tamanho,
      estilo:           ctx.estilo,
      cidade:           ctx.cidade,
      status_comercial: statusComercial,
      proxima_acao:     ctx.proxima_acao,
      valor_potencial:  ctx.valor_potencial ? Number(ctx.valor_potencial) : estimateValue(ctx),
      status:           statusComercial === 'QUENTE' ? 'encaminhado' : 'qualificado',
      context:          ctx,
    });
  }

  // ── 5. Monta texto da resposta ────────────────────────────────────────────
  const nextCfg = flowConfig.get(nextNodeId);
  let text: string;

  if (nextCfg?.message) {
    text = nextCfg.message.replace(/\{(\w+)\}/g, (_, k) => ctx[k] || '');
  } else {
    const rawMessage = typeof nextNode.message === 'function'
      ? nextNode.message(ctx)
      : nextNode.message;
    text = rawMessage.replace('{wa_link}', ctx.wa_link || '');
  }

  // ── 6. Define próximo estado ──────────────────────────────────────────────
  const finalNode: NodeId = nextNode.terminal ? 'INICIO' : nextNodeId;

  // ── 7. Persiste sessão ────────────────────────────────────────────────────
  await updateSession(storeId, session.phone, finalNode, ctx);

  // ── 8. Salva mensagem de saída ────────────────────────────────────────────
  await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida', conteudo: text, node: nextNodeId });

  return { text, nextNode: finalNode, context: ctx };
}
