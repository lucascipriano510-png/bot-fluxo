import { FLOW_MAP, NodeId } from './flowMap';
import { supabase } from '../lib/supabase';
import { BotSession, BotResponse } from '../types';
import { updateSession } from '../services/sessionService';
import { saveMensagem, fetchHistorico } from '../services/mensagemService';
import { registerLead, upsertLeadLight } from '../services/leadService';
import { generateWhatsAppLink } from '../providers/messaging';
import { isOptedOut, registerOptOut, removeOptOut } from '../services/optoutService';
import { isBusinessHours, openingTimeStr } from '../utils/businessHours';
import { loadFlowConfig, triggerToRegex } from '../services/flowConfigService';
import { getStoreById } from '../services/storeService';
import {
  detectProductQuery,
  logInventoryQuery,
  loadStoreCategories,
} from '../inventory/inventoryBridge';
import {
  findOffersWithFallback,
  formatFallbackResponse,
  buildOfferFilters,
} from '../catalog/catalogBridge';
import { detectIntent } from '../services/intentService';
import { handleIntent } from '../services/chatBrainService';
import { aiAssistFull, AiAssistContext, buildSegmentInstructions } from '../services/aiAssistService';
import { maybeUpdateLeadMemory } from '../services/leadMemoryService';
import { getStoreBrain, buildBrainContext, StoreBrain } from '../services/storeBrainService';
import { buildCatalogSnippet, buildLeadProfile } from '../services/storeMindService';
import { buildRuntimeKnowledgeContext } from '../services/storeKnowledgeService';
import { getRuntimeSettings } from '../services/settingsService';

// ── Cache de respostas rápidas por store (TTL 30s) ────────────────────────────
const _rrCache = new Map<string, { data: Array<{ gatilhos: string[]; resposta: string; prioridade: number }>; expiresAt: number }>();

async function getRespostasRapidas(storeId: string) {
  const now    = Date.now();
  const cached = _rrCache.get(storeId);
  if (cached && now < cached.expiresAt) return cached.data;

  const { data } = await supabase
    .from('bot_respostas_rapidas')
    .select('gatilhos, resposta, prioridade')
    .eq('store_id', storeId)
    .eq('ativo', true)
    .order('prioridade', { ascending: false });

  const result = (data || []) as Array<{ gatilhos: string[]; resposta: string; prioridade: number }>;
  _rrCache.set(storeId, { data: result, expiresAt: now + 30_000 });
  return result;
}

function estimateValue(_ctx: Record<string, string>): number {
  return 100;
}

const OPTOUT_TRIGGER = /\b(parar|stop|sair|cancelar|n[aã]o quero|remover|descadastrar|opt.?out)\b/i;
const REOPT_TRIGGER  = /\b(quero receber|ativar|retomar|voltar|continuar|ol[aá]|oi\b)/i;

function inferKanbanStage(
  intent: string,
  ctx: Record<string, string>,
  catalogReturned: boolean,
  messageText?: string,
): string {
  const msg = (messageText || '').toLowerCase();
  if (/\b(vou querer|pode separar|fechado|quero comprar|vou levar|fechar pedido|finalizar)\b/.test(msg)) return 'pagamento';
  if (intent === 'payment' || /\b(como (compro|pago|faço pra comprar)|forma de pagamento|parcela)\b/.test(msg)) return 'carrinho';
  if (ctx.nome && ctx.interesse) return 'escolhendo';
  if (catalogReturned || ['compra', 'orcamento', 'price', 'disponibilidade', 'busca_item', 'catalog'].includes(intent)) return 'interessado';
  return 'novo';
}

export async function processMessage(
  session: BotSession,
  messageText: string,
  opts: { simulate?: boolean } = {},
): Promise<BotResponse> {

  // Contexto da loja — fonte de verdade é sempre session.store_id (UUID)
  const storeId  = session.store_id;
  const storeCtx = await getStoreById(storeId);

  // ── PRÉ-CHECAGEM 0: Bot ativo ─────────────────────────────────────────────
  // O "bot desligado" só silencia o canal REAL (WhatsApp). No SIMULADOR
  // (opts.simulate) o engine sempre roda, pra você testar sem ir pro ar.
  const rtSettings = await getRuntimeSettings(storeId);
  if (!opts.simulate && !rtSettings.bot_ativo) {
    return { text: '', nextNode: session.current_node || 'INICIO', context: session.context };
  }

  // ── PRÉ-CHECAGEM 0b: Humano ativo — bot silencioso ────────────────────────
  if (session.humano_ativo === true) {
    await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: 'HUMANO' });
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
  const flowConfig        = await loadFlowConfig(storeId);
  const runtimeKnowledge  = await buildRuntimeKnowledgeContext(storeId);

  const currentNodeId = (session.current_node as NodeId) || 'INICIO';
  const currentNode   = FLOW_MAP[currentNodeId] || FLOW_MAP['INICIO'];

  // Injeta contexto enriquecido pela StoreKnowledgeBase
  const ctx: Record<string, string> = {
    ...session.context,
    _storeName:    storeCtx.name,
    _wa_loja:      storeCtx.whatsappNumber,
    _saudacao:     rtSettings.saudacao,
    // Identity knowledge
    _city:          runtimeKnowledge.identity.city         || '',
    _state:         runtimeKnowledge.identity.state        || '',
    _instagram:     runtimeKnowledge.identity.instagram    || '',
    _businessType:  runtimeKnowledge.identity.businessType || '',
    // Commercial knowledge
    _deliveryInfo:  runtimeKnowledge.commercial.deliveryInfo  || '',
    _paymentInfo:   runtimeKnowledge.commercial.paymentInfo   || '',
    _openingHours:  runtimeKnowledge.commercial.openingHours  || '',
    _siteUrl:       runtimeKnowledge.commercial.siteUrl || runtimeKnowledge.websiteSensor?.websiteUrl || '',
    _catalogUrl:    runtimeKnowledge.commercial.catalogUrl    || '',
    _returnPolicy:  runtimeKnowledge.commercial.returnPolicy  || '',
    _discountRules: runtimeKnowledge.commercial.discountRules || '',
    // Voice
    _salesTone:     runtimeKnowledge.voice.salesTone || '',
  };

  // ── PRÉ-CHECAGEM 3b: Respostas Rápidas ───────────────────────────────────
  const respostasRapidas = await getRespostasRapidas(storeId);
  if (respostasRapidas.length > 0) {
    const msgNorm = messageText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    for (const rr of respostasRapidas) {
      const matched = (rr.gatilhos || []).some(g =>
        msgNorm.includes(g.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
      );
      if (matched) {
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: rr.resposta, node: 'RESPOSTA_RAPIDA' });
        return { text: rr.resposta, nextNode: currentNodeId, context: ctx };
      }
    }
  }

  // ── PRÉ-CHECAGEM 4: Roteamento por intenção + catálogo ──────────────────
  // Detecta intenção antes de buscar catálogo para evitar buscas desnecessárias
  // em saudações, pedidos de atendente e orçamentos.
  let intentResult = detectIntent(messageText);

  // Mensagens longas (> 4 palavras) com confidence baixa são ambíguas — a IA
  // resolve melhor que regex com score único de secondary hit (0.62).
  if (intentResult.confidence < 0.75 && messageText.trim().split(/\s+/).length > 4) {
    intentResult = { intent: 'unknown', confidence: 0 };
  }

  // Mensagem composta: "bom dia, tem camisa preta?" → greeting ganha com score
  // secundário (0.62). Se há filtro de catálogo claro, executa catálogo diretamente.
  if (intentResult.intent === 'greeting' && intentResult.confidence < 0.85) {
    const compoundFilters = await detectProductQuery(messageText, storeId);
    if (compoundFilters) {
      const offerFilters                 = buildOfferFilters(storeId, compoundFilters);
      const { offers, matched, dropped } = await findOffersWithFallback(offerFilters);
      if (offers.length > 0) {
        const reply = formatFallbackResponse(offers, offerFilters, matched, dropped);
        logInventoryQuery(storeId, session.phone, messageText, compoundFilters, offers.length, reply);
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: reply,       node: 'CATALOG' });
        upsertLeadLight({ store_id: storeId, phone: session.phone, nome: ctx.nome, interesse: compoundFilters.category || ctx.interesse, cidade: ctx.cidade, valor_potencial: Number(offers[0]?.price) || undefined, status_comercial: 'MORNO', stage_hint: 'interessado', context: ctx }).catch(() => {});
        return { text: reply, nextNode: currentNodeId, context: ctx };
      }
    }
  }

  // Mensagem composta produto + preço: "tem camisa Lacoste G? qual o valor?"
  // price é detectado como intent principal, mas a mensagem também contém
  // filtros de produto. Executa catálogo primeiro e responde com produto + preço.
  if (intentResult.intent === 'price' || intentResult.intent === 'price_sensitivity') {
    const priceProductFilters = await detectProductQuery(messageText, storeId);
    const hasProductFilter = priceProductFilters && (
      priceProductFilters.category ||
      priceProductFilters.size ||
      priceProductFilters.subcategory
    );
    if (hasProductFilter) {
      const offerFilters = buildOfferFilters(storeId, priceProductFilters!);
      const { offers, matched, dropped } = await findOffersWithFallback(offerFilters);
      if (offers.length > 0) {
        const reply = formatFallbackResponse(offers, offerFilters, matched, dropped);
        logInventoryQuery(storeId, session.phone, messageText, priceProductFilters, offers.length, reply);
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: reply,       node: 'CATALOG' });
        upsertLeadLight({ store_id: storeId, phone: session.phone, nome: ctx.nome, interesse: priceProductFilters!.category || ctx.interesse, cidade: ctx.cidade, valor_potencial: Number(offers[0]?.price) || undefined, status_comercial: 'MORNO', stage_hint: 'interessado', context: ctx }).catch(() => {});
        return { text: reply, nextNode: currentNodeId, context: ctx };
      }
      logInventoryQuery(storeId, session.phone, messageText, priceProductFilters, 0, '(price+product fallback to brain/ai)');
    }
  }

  // Intenções que nunca devem acionar busca de catálogo.
  // Regra: qualquer intenção identificada com semântica não-produto vai para
  // brain/AI. Catálogo só roda para busca_item, disponibilidade e unknown.
  const NON_CATALOG = [
    // conversacionais
    'greeting', 'thanks', 'farewell',
    'identidade_loja', 'conversa_geral', 'duvida_operacional',
    // site e catálogo online
    'store_site', 'catalog',
    // compra e atendimento
    'orcamento', 'compra', 'humano',
    // operacionais — já tratados pelo brain com respostas contextuais
    'delivery', 'hours', 'location', 'payment', 'exchange',
    'complaint', 'wholesale', 'gift', 'new_arrivals',
    'price', 'price_sensitivity', 'size_help',
  ];

  if (!NON_CATALOG.includes(intentResult.intent)) {
    const rawFilters = await detectProductQuery(messageText, storeId);
    if (rawFilters) {
      const offerFilters                 = buildOfferFilters(storeId, rawFilters);
      const { offers, matched, dropped } = await findOffersWithFallback(offerFilters);

      // Só retornar resultado de catálogo quando há ofertas — catálogo vazio
      // sempre cai para AI Assist ou brain para tratar de forma conversacional.
      if (offers.length > 0) {
        const reply = formatFallbackResponse(offers, offerFilters, matched, dropped);
        logInventoryQuery(storeId, session.phone, messageText, rawFilters, offers.length, reply);
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: reply,       node: 'CATALOG' });
        upsertLeadLight({ store_id: storeId, phone: session.phone, nome: ctx.nome, interesse: rawFilters.category || ctx.interesse, cidade: ctx.cidade, valor_potencial: Number(offers[0]?.price) || undefined, status_comercial: 'MORNO', stage_hint: 'interessado', context: ctx }).catch(() => {});
        return { text: reply, nextNode: currentNodeId, context: ctx };
      }
      logInventoryQuery(storeId, session.phone, messageText, rawFilters, 0, '(ai/brain fallback)');
    }
  }

  // ── PRÉ-CHECAGEM 5: Camada de IA Assist (para intents conversacionais) ────
  // Roda antes do brain fixo. Se IA não estiver configurada, retorna null e
  // cai no brain fixo sem impacto de performance (só lê env vars).
  const AI_ASSIST_INTENTS = new Set([
    // conversacionais originais
    'conversa_geral', 'identidade_loja', 'store_site', 'duvida_operacional', 'unknown',
    // intents que ganham com linguagem adaptada
    'complaint', 'price_sensitivity', 'gift', 'wholesale', 'new_arrivals', 'catalog', 'busca_item',
  ]);
  // A "mente": catálogo real (cor/preço/descrição) + perfil do lead no CRM.
  // Calculado uma vez; reusado tanto no AI Assist quanto no fallback do brain.
  const catalogSnippet = await buildCatalogSnippet(storeId, messageText).catch(() => '');
  const leadProfile    = await buildLeadProfile(storeId, session.phone).catch(() => '');

  if (AI_ASSIST_INTENTS.has(intentResult.intent)) {
    // Carrega brain da loja (cacheado 5min)
    const brain    = await getStoreBrain(storeId).catch(() => ({} as StoreBrain));
    const brainCtx = buildBrainContext(brain);

    // Busca histórico da sessão para dar memória conversacional à IA
    const rawHistory = await fetchHistorico(storeId, session.phone, 8);
    const mappedHistory = rawHistory
      .filter(m => m.node !== 'OPTOUT' && m.node !== 'FORA_HORARIO')
      .map(m => ({
        role: m.direcao === 'entrada' ? 'user' as const : 'assistant' as const,
        content: m.conteudo,
      }));

    // Trunca mensagens individuais longas
    const truncated = mappedHistory.map(turn => ({
      ...turn,
      content: turn.content.length > 300 ? turn.content.slice(0, 300) + '...' : turn.content,
    }));

    // Mantém apenas as mais recentes que cabem em 1500 chars no total
    let totalChars = 0;
    const conversationHistory = [...truncated].reverse().filter(turn => {
      totalChars += turn.content.length;
      return totalChars <= 1_500;
    }).reverse();

    console.log(`[aiAssist] history=${conversationHistory.length} turns loaded`);

    const site = runtimeKnowledge.websiteSensor;
    const storeCategories5 = await loadStoreCategories(storeId).catch(() => [] as string[]);
    const aiCtx: AiAssistContext = {
      storeName:       ctx._storeName    || 'nossa loja',
      businessType:    ctx._businessType || undefined,
      city:            ctx._city         || undefined,
      storePhone:      ctx._wa_loja      || undefined,
      openingHours:    ctx._openingHours || undefined,
      deliveryInfo:    ctx._deliveryInfo || undefined,
      paymentInfo:     ctx._paymentInfo  || undefined,
      greetingMsg:     intentResult.intent === 'greeting' ? (ctx._saudacao || undefined) : undefined,
      // Site URL do perfil (sempre disponível se configurado)
      siteUrl:         ctx._siteUrl  || site?.websiteUrl || undefined,
      // Site Sensor — dados ricos só quando scan foi executado
      siteTitle:       site?.extracted?.storeName || undefined,
      siteDescription: site?.rawSummary
        ? site.rawSummary.split('\n').find(l => l.startsWith('Descrição:'))?.replace('Descrição: ', '')
        : undefined,
      siteSummary:          site?.rawSummary        || undefined,
      conversationHistory:  conversationHistory.length > 0 ? conversationHistory : undefined,
      storeCategories:      storeCategories5.length > 0 ? storeCategories5 : undefined,
      segmentInstructions:  buildSegmentInstructions(ctx._businessType, storeCategories5),
      storeBrain:           brainCtx || undefined,
      catalogSnippet:       catalogSnippet || undefined,
      leadProfile:          leadProfile || undefined,
    };
    const aiResult = await aiAssistFull(messageText, aiCtx, intentResult.intent, { storeId, phone: session.phone });
    if (aiResult.text || aiResult.media.length > 0) {
      const logText = aiResult.text || `📷 ${aiResult.media.map(m => m.caption).join(' | ')}`;
      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
      await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: logText,     node: 'AI_ASSIST' });
      maybeUpdateLeadMemory(storeId, session.phone);
      return { text: aiResult.text || '', nextNode: currentNodeId, context: ctx, detectedIntent: intentResult.intent, confidence: intentResult.confidence, media: aiResult.media };
    }
  }

  // ── PRÉ-CHECAGEM 6: Brain fixo (fallback quando IA não está configurada) ──
  const brainResult = handleIntent(messageText, intentResult, ctx, currentNodeId);
  if (brainResult) {
    // Brain sinalizou que não tem dado estruturado — deixa a IA assumir se disponível
    if (brainResult.usedFallback) {
      const site = runtimeKnowledge.websiteSensor;
      const storeCategories6 = await loadStoreCategories(storeId).catch(() => [] as string[]);
      const brain6    = await getStoreBrain(storeId).catch(() => ({} as StoreBrain));
      const brainCtx6 = buildBrainContext(brain6);
      const aiCtx: AiAssistContext = {
        storeName:       ctx._storeName    || 'nossa loja',
        businessType:    ctx._businessType || undefined,
        city:            ctx._city         || undefined,
        storePhone:      ctx._wa_loja      || undefined,
        openingHours:    ctx._openingHours || undefined,
        deliveryInfo:    ctx._deliveryInfo || undefined,
        paymentInfo:     ctx._paymentInfo  || undefined,
        siteUrl:         ctx._siteUrl  || site?.websiteUrl || undefined,
        siteTitle:       site?.extracted?.storeName || undefined,
        siteDescription: site?.rawSummary
          ? site.rawSummary.split('\n').find(l => l.startsWith('Descrição:'))?.replace('Descrição: ', '')
          : undefined,
        siteSummary:         site?.rawSummary || undefined,
        storeCategories:     storeCategories6.length > 0 ? storeCategories6 : undefined,
        segmentInstructions: buildSegmentInstructions(ctx._businessType, storeCategories6),
        storeBrain:          brainCtx6 || undefined,
        catalogSnippet:      catalogSnippet || undefined,
        leadProfile:         leadProfile || undefined,
      };
      const aiFallback = await aiAssistFull(messageText, aiCtx, intentResult.intent, { storeId, phone: session.phone });
      if (aiFallback.text || aiFallback.media.length > 0) {
        const logText = aiFallback.text || `📷 ${aiFallback.media.map(m => m.caption).join(' | ')}`;
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'entrada', conteudo: messageText, node: currentNodeId });
        await saveMensagem({ store_id: storeId, phone: session.phone, direcao: 'saida',   conteudo: logText,     node: 'AI_ASSIST' });
        maybeUpdateLeadMemory(storeId, session.phone);
        return { text: aiFallback.text || '', nextNode: currentNodeId, context: ctx, detectedIntent: intentResult.intent, confidence: intentResult.confidence, media: aiFallback.media };
      }
    }

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

  // Captura automática para intents comerciais que não passaram pelo catálogo
  const COMMERCIAL_INTENTS = ['busca_item', 'catalog', 'price', 'compra', 'orcamento', 'disponibilidade', 'price_sensitivity', 'gift', 'new_arrivals', 'wholesale'];
  if (COMMERCIAL_INTENTS.includes(intentResult.intent)) {
    upsertLeadLight({
      store_id:         storeId,
      phone:            session.phone,
      nome:             ctx.nome,
      interesse:        ctx.interesse || undefined,
      cidade:           ctx.cidade,
      status_comercial: 'FRIO',
      stage_hint:       inferKanbanStage(intentResult.intent, ctx, false, messageText),
      context:          ctx,
    }).catch(() => {});
  }

  return { text, nextNode: finalNode, context: ctx };
}
