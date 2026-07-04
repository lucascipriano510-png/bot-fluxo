// ═══════════════════════════════════════════════════════════════════════════
//  aiAssistService — Camada de IA controlada para respostas conversacionais
//
//  Providers suportados (AI_ASSIST_PROVIDER):
//    gemini    — Google Generative AI (REST). Modelo padrão gemini-2.5-flash.
//                Multimodal completo: agente + áudio + visão na mesma chave.
//    anthropic — Claude via SDK oficial. Modelo padrão claude-haiku-4-5.
//                Agente + visão; áudio precisa de GEMINI_KEY separada (opcional).
//
//  Guardrails: nunca inventa preço, estoque, produto, prazo, endereço ou promoção.
//  Quando não há dados, redireciona para atendimento — nunca diz "não sei".
//  API key NUNCA sai do backend — nunca exposta no frontend ou nos logs.
//
//  MODO AGENTE (quando o engine passa storeId+phone): a IA ganha ferramentas
//  reais — buscar_produtos (catálogo), salvar_dados_cliente (CRM) e
//  chamar_atendente (handoff) — e decide sozinha quando usá-las, em loop de
//  até 3 rodadas de tool calling. Fallback de modelo automático em erro/429.
// ═══════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { getCatalogForMind, MindProduct } from './storeMindService';
import { upsertLeadLight } from './leadService';
import { notifyHandoff } from './handoffBus';
import { fetchSiteOrders, summarizeOrderItems } from '../inventory/sitePurchasesBridge';
import { supabase } from '../lib/supabase';
import { phoneVariants } from '../utils/phone';

// ── Cliente Anthropic (provider "anthropic" — Claude Haiku como cérebro) ────
let _anthropic: Anthropic | null = null;
function anthropicClient(key: string): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

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
  // A "mente": catálogo real (com cor/preço/descrição) e perfil do lead no CRM
  catalogSnippet?:      string;
  leadProfile?:         string;
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

  // A "mente": catálogo real e perfil do cliente
  const catalogSection = ctx.catalogSnippet
    ? `\nCATÁLOGO (única fonte de produtos e preços — fale SÓ do que está aqui):\n${ctx.catalogSnippet}`
    : '';
  const leadSection = ctx.leadProfile
    ? `\nCLIENTE (perfil do CRM — use pra personalizar, trate pelo nome se houver):\n${ctx.leadProfile}`
    : '';

  const intentInstruction = intentHint && INTENT_INSTRUCTIONS[intentHint]
    ? `\nCONTEXTO DA MENSAGEM ATUAL:\n${INTENT_INSTRUCTIONS[intentHint]}`
    : '';

  // Com catálogo em mãos, a IA PODE cotar preço/produto que estão nele.
  const catalogRule = ctx.catalogSnippet
    ? '- Para produto/preço/cor/tamanho, responda usando SOMENTE o CATÁLOGO acima (pode dizer preço e detalhes que estão nele). Se o cliente pedir algo que NÃO está no catálogo, diga que vai verificar e ofereça o que tem de parecido.'
    : '';

  return [
    `Você é o vendedor da loja ${storeName} — atende no WhatsApp como um funcionário real, simpático e que entende do produto.`,
    '',
    'DADOS DA LOJA:',
    storeData,
    segmentSection,
    brainSection,
    catalogSection,
    leadSection,
    '',
    'REGRAS DE RESPOSTA (OBRIGATÓRIAS):',
    `- ${greetingRule}`,
    catalogRule,
    '- Respostas SEMPRE completas. NUNCA termine no meio de uma frase ou com vírgula.',
    '- Máximo 3 linhas. Seja direto, comercial e humano; puxe a venda (sugira tamanho, cor, fechar pedido).',
    '- NUNCA use expressões como "não tenho essa informação" ou "não sei". Em vez disso, ofereça ajuda.',
    missingDataRule ? `- ${missingDataRule.replace(/\n/g, '\n- ')}` : '',
    intentInstruction,
    '',
    GUARDRAILS,
  ].filter(s => s !== '').join('\n');
}

// ── Identificadores que habilitam o modo agente (ferramentas) ───────────────
export interface AgentIds {
  storeId: string;
  phone:   string;
}

// ── Mídia gerada pelas ferramentas (fotos de produto pro WhatsApp) ──────────
export interface AgentMedia {
  imageUrl: string;
  caption:  string;
}

export interface AiAssistResult {
  text:  string | null;
  media: AgentMedia[];
}

// Fotos saem pelo proxy wsrv.nl (mesmo padrão do site): o upload original é
// full-res (1–5 MB); sem o resize o WhatsApp sofre pra baixar e o envio trava.
function wsrvImage(url: string, width = 800): string {
  if (!url) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=80&output=webp&we&sharp=1`;
}

const brlA = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

// ── Contador de uso de IA (reinicia a cada dia, em memória) ─────────────────
const _usage = { date: '', calls: 0, toolCalls: 0, errors: 0, fallbacks: 0, transcriptions: 0 };

function bumpUsage(k: 'calls' | 'toolCalls' | 'errors' | 'fallbacks' | 'transcriptions'): void {
  const today = new Date().toISOString().slice(0, 10);
  if (_usage.date !== today) {
    _usage.date = today;
    _usage.calls = _usage.toolCalls = _usage.errors = _usage.fallbacks = _usage.transcriptions = 0;
  }
  _usage[k]++;
}

export function getAiUsage() {
  return { ..._usage };
}

// ── Ferramentas do agente (Gemini function calling) ─────────────────────────
const TOOL_DECLARATIONS = [
  {
    name: 'buscar_produtos',
    description: 'Busca produtos REAIS no catálogo da loja, com preço, cores e tamanhos. Use SEMPRE que o cliente perguntar sobre produto, preço, cor, tamanho ou disponibilidade e a resposta não estiver no contexto.',
    parameters: {
      type: 'object',
      properties: {
        busca:     { type: 'string', description: 'Termos livres de busca, ex: "camisa lacoste preta"' },
        categoria: { type: 'string', description: 'Categoria, ex: "camisa", "calça", "bermuda"' },
        cor:       { type: 'string', description: 'Cor desejada, ex: "preta"' },
        tamanho:   { type: 'string', description: 'Tamanho, ex: "G", "42"' },
        preco_max: { type: 'number', description: 'Preço máximo em reais' },
      },
    },
  },
  {
    name: 'salvar_dados_cliente',
    description: 'Salva no CRM dados que o cliente informou na conversa (nome, tamanho, cidade, interesse). Chame assim que o cliente informar algo novo — não pergunte de novo o que já foi dito.',
    parameters: {
      type: 'object',
      properties: {
        nome:      { type: 'string' },
        tamanho:   { type: 'string' },
        cidade:    { type: 'string' },
        interesse: { type: 'string', description: 'O que o cliente está buscando' },
      },
    },
  },
  {
    name: 'chamar_atendente',
    description: 'Aciona um atendente humano da loja. Use quando o cliente pedir para falar com uma pessoa ou quando você não conseguir resolver.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Resumo curto do que o cliente precisa' },
      },
    },
  },
  {
    name: 'enviar_fotos_produtos',
    description: 'Envia FOTOS reais de até 4 produtos do catálogo direto no WhatsApp do cliente, com preço na legenda. Use quando o cliente pedir foto, quiser "ver" a peça, ou quando mostrar o produto ajudar a fechar a venda.',
    parameters: {
      type: 'object',
      properties: {
        busca:     { type: 'string', description: 'Termos do produto, ex: "camisa lacoste preta"' },
        cor:       { type: 'string' },
        tamanho:   { type: 'string' },
        preco_max: { type: 'number' },
      },
    },
  },
  {
    name: 'montar_link_sacola',
    description: 'Monta um link do site que abre com a sacola JÁ PRONTA com os itens escolhidos — o cliente só clica e finaliza a compra. Use quando o cliente decidir levar ("quero", "vou levar", "fecha"). Informe o SKU exato retornado por buscar_produtos ou enviar_fotos_produtos.',
    parameters: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          description: 'Itens escolhidos pelo cliente',
          items: {
            type: 'object',
            properties: {
              sku:     { type: 'string', description: 'SKU exato do produto' },
              tamanho: { type: 'string', description: 'Tamanho escolhido (obrigatório quando o produto tem tamanhos)' },
              qtd:     { type: 'number', description: 'Quantidade (padrão 1)' },
            },
          },
        },
      },
    },
  },
  {
    name: 'consultar_pedidos_cliente',
    description: 'Consulta os pedidos que ESTE cliente já fez no site (itens, valor, status). Use quando ele perguntar sobre pedido, compra anterior ou entrega de algo que já comprou.',
    parameters: { type: 'object', properties: {} },
  },
];

// Mesmas ferramentas no formato da API Anthropic (name/description/input_schema)
const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOL_DECLARATIONS.map(t => ({
  name:         t.name,
  description:  t.description,
  input_schema: t.parameters as Anthropic.Tool.InputSchema,
}));

const TOOLS_NOTE = `

FERRAMENTAS DISPONÍVEIS (use-as, não descreva):
- buscar_produtos: consulta o catálogo REAL. Use antes de afirmar qualquer coisa sobre produto, preço, cor, tamanho ou estoque que não esteja no CATÁLOGO acima.
- enviar_fotos_produtos: manda a FOTO real da peça com preço na legenda. Foto vende mais que texto — use quando o cliente pedir pra ver ou estiver quase decidindo.
- montar_link_sacola: quando o cliente decidir levar, monte o link da sacola pronta e envie na resposta — ele só clica e paga. É assim que você FECHA a venda.
- consultar_pedidos_cliente: pedidos anteriores deste cliente no site.
- salvar_dados_cliente: registre nome, tamanho, cidade ou interesse assim que o cliente informar.
- chamar_atendente: acione quando o cliente pedir uma pessoa de verdade ou algo que você não resolve.
Se buscar_produtos não retornar nada, ofereça o mais parecido que existir — nunca invente produto ou preço.
Quando enviar fotos, NÃO descreva as fotos no texto: faça um convite curto pra escolher/fechar.`;

const normA = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Filtro + ranqueamento compartilhado por buscar_produtos e enviar_fotos_produtos
async function searchCatalog(storeId: string, args: Record<string, unknown>, max: number): Promise<MindProduct[]> {
  const catalog = await getCatalogForMind(storeId);
  let list = catalog;
  if (args.categoria) list = list.filter(p => normA(`${p.category} ${p.subcategory} ${p.type} ${p.name}`).includes(normA(args.categoria)));
  if (args.cor)       list = list.filter(p => normA([p.color, ...p.secondary].join(' ')).includes(normA(args.cor)));
  if (args.tamanho)   list = list.filter(p => p.sizes.length === 0 || p.sizes.map(s => s.toUpperCase()).includes(String(args.tamanho).toUpperCase()));
  if (args.preco_max) list = list.filter(p => (p.promo ?? p.price) <= Number(args.preco_max));

  const tokens = normA(args.busca).split(/\s+/).filter(t => t.length >= 3);
  const scored = list.map(p => {
    const hay = normA([p.name, p.category, p.subcategory, p.color, p.secondary.join(' '), p.type, p.tags.join(' '), p.desc].join(' '));
    return { p, s: tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) };
  }).sort((a, b) => b.s - a.s || (b.p.featured ? 1 : 0) - (a.p.featured ? 1 : 0) || a.p.price - b.p.price);

  return (tokens.length > 0 ? scored.filter(x => x.s > 0) : scored).slice(0, max).map(x => x.p);
}

// Exportado para o eval/testes — o runtime chama via loop do agente
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ids: AgentIds,
  collector: { media: AgentMedia[] },
): Promise<Record<string, unknown>> {
  if (name === 'buscar_produtos') {
    const top = (await searchCatalog(ids.storeId, args, 8)).map(p => ({
      sku:            p.sku || undefined,
      nome:           p.name,
      categoria:      [p.category, p.subcategory].filter(Boolean).join('/') || undefined,
      cor:            [p.color, ...p.secondary].filter(Boolean).join(' e ') || undefined,
      preco:          p.promo ?? p.price,
      preco_original: p.promo ? p.price : undefined,
      tamanhos:       p.sizes.length > 0 ? p.sizes : undefined,
      descricao:      p.desc ? p.desc.slice(0, 100) : undefined,
      tem_foto:       !!p.image,
    }));
    return { encontrados: top.length, produtos: top };
  }

  if (name === 'enviar_fotos_produtos') {
    const found = (await searchCatalog(ids.storeId, args, 12)).filter(p => p.image).slice(0, 4);
    for (const p of found) {
      const preco = p.promo ? `${brlA(p.promo)} (de ${brlA(p.price)})` : brlA(p.price);
      const tam   = p.sizes.length > 0 ? ` · ${p.sizes.slice(0, 6).join('/')}` : '';
      collector.media.push({
        imageUrl: wsrvImage(p.image),
        caption:  `${p.name} · ${preco}${tam}`,
      });
    }
    return {
      fotos_enviadas: found.length,
      produtos: found.map(p => ({ sku: p.sku || undefined, nome: p.name, preco: p.promo ?? p.price, tamanhos: p.sizes })),
      aviso: found.length > 0
        ? 'As fotos serão anexadas automaticamente à sua resposta. Escreva só um convite curto pra escolher ou fechar — NÃO descreva as fotos.'
        : 'Nenhum produto com foto encontrado para esses filtros. Ofereça alternativas via buscar_produtos.',
    };
  }

  if (name === 'montar_link_sacola') {
    const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
    if (!siteUrl) return { erro: 'Loja sem site configurado. Encaminhe para o atendente fechar o pedido.' };

    const itens = Array.isArray(args.itens) ? args.itens as Array<Record<string, unknown>> : [];
    if (itens.length === 0) return { erro: 'Nenhum item informado.' };

    const catalog = await getCatalogForMind(ids.storeId);
    const parts: string[] = [];
    const confirmados: string[] = [];
    for (const item of itens) {
      const sku = String(item.sku || '').trim();
      if (!sku) continue;
      const prod = catalog.find(p => p.sku && p.sku.toUpperCase() === sku.toUpperCase());
      if (!prod) return { erro: `SKU ${sku} não encontrado no catálogo. Confirme o produto com buscar_produtos.` };
      const tamanho = String(item.tamanho || '').trim().toUpperCase();
      if (prod.sizes.length > 0 && !tamanho) return { erro: `${prod.name} tem tamanhos (${prod.sizes.join('/')}). Pergunte o tamanho antes de montar a sacola.` };
      const qtd = Math.max(1, Math.min(10, Number(item.qtd) || 1));
      parts.push([prod.sku, tamanho || null, qtd > 1 ? qtd : null].filter(Boolean).join(':'));
      confirmados.push(`${prod.name}${tamanho ? ` tam ${tamanho}` : ''}${qtd > 1 ? ` x${qtd}` : ''}`);
    }
    if (parts.length === 0) return { erro: 'Nenhum item válido.' };

    const link = `${siteUrl}/?sacola=${parts.join(',')}`;
    return {
      ok: true,
      link,
      itens: confirmados,
      aviso: 'Envie o link na resposta e diga que a sacola já está montada — é só finalizar. Confirme os itens em uma linha.',
    };
  }

  if (name === 'consultar_pedidos_cliente') {
    // O phone da sessão pode ser LID; o telefone real fica em bot_leads.phone_real
    const { data: lead } = await supabase
      .from('bot_leads')
      .select('phone_real')
      .eq('store_id', ids.storeId)
      .eq('phone', ids.phone)
      .maybeSingle();

    const candidates = new Set<string>();
    for (const raw of [ids.phone, lead?.phone_real].filter(Boolean) as string[]) {
      for (const v of phoneVariants(raw)) candidates.add(v.replace(/\D/g, '').slice(-8));
    }

    const orders = await fetchSiteOrders(500);
    const doCliente = orders.filter(o => {
      const d = String(o.phone || '').replace(/\D/g, '').slice(-8);
      return d.length === 8 && candidates.has(d);
    }).slice(0, 5).map(o => ({
      pedido: o.order_number || o.id.slice(0, 8),
      itens:  summarizeOrderItems(o.items),
      valor:  o.value != null ? Number(o.value) : undefined,
      status: o.status || undefined,
      data:   o.created_at ? o.created_at.slice(0, 10) : undefined,
    }));

    return doCliente.length > 0
      ? { encontrados: doCliente.length, pedidos: doCliente }
      : { encontrados: 0, aviso: 'Nenhum pedido encontrado para este cliente no site. Pergunte o número do pedido ou ofereça o atendente.' };
  }

  if (name === 'salvar_dados_cliente') {
    await upsertLeadLight({
      store_id:         ids.storeId,
      phone:            ids.phone,
      nome:             args.nome      ? String(args.nome).slice(0, 50)       : undefined,
      tamanho:          args.tamanho   ? String(args.tamanho).slice(0, 10)    : undefined,
      cidade:           args.cidade    ? String(args.cidade).slice(0, 40)     : undefined,
      interesse:        args.interesse ? String(args.interesse).slice(0, 200) : undefined,
      status_comercial: 'MORNO',
    });
    return { ok: true };
  }

  if (name === 'chamar_atendente') {
    const motivo = String(args.motivo || 'cliente pediu atendimento').slice(0, 200);
    await upsertLeadLight({
      store_id:         ids.storeId,
      phone:            ids.phone,
      status_comercial: 'QUENTE',
      stage_hint:       'interessado',
    });
    notifyHandoff(ids.storeId, ids.phone, motivo);
    return { ok: true, aviso: 'Atendente notificado. Diga ao cliente que uma pessoa da loja vai falar com ele em instantes.' };
  }

  return { erro: `ferramenta desconhecida: ${name}` };
}

// ── Loop do agente: chamada com ferramentas, até 3 rodadas de tool calling ──
async function callGeminiAgent(
  message: string,
  systemPrompt: string,
  key: string,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
  ids: AgentIds,
  collector: { media: AgentMedia[] },
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const contents: Array<Record<string, unknown>> = [
    ...(history ?? []).map(turn => ({
      role:  turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  for (let round = 0; round < 4; round++) {
    const lastRound = round === 3;
    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      // Nos modelos 2.5 o "thinking" consome o maxOutputTokens e corta a
      // resposta no meio — desligamos (não precisa raciocínio longo pra vender)
      generationConfig:  {
        maxOutputTokens: 350,
        temperature: 0.5,
        ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
      tools:             [{ functionDeclarations: TOOL_DECLARATIONS }],
      toolConfig:        { functionCallingConfig: { mode: lastRound ? 'NONE' : 'AUTO' } },
    };

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(12_000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Gemini ${resp.status}: ${errBody.slice(0, 200)}`);
    }

    const json  = await resp.json() as Record<string, any>;
    const parts: Array<Record<string, any>> = json?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter(p => p.functionCall);

    if (calls.length === 0) {
      const text = parts.map(p => p.text).filter(Boolean).join('').trim();
      return text || null;
    }

    contents.push({ role: 'model', parts });
    for (const c of calls) {
      bumpUsage('toolCalls');
      const fc     = c.functionCall as { name: string; args?: Record<string, unknown> };
      const result = await executeTool(fc.name, fc.args || {}, ids, collector)
        .catch(err => ({ erro: String((err as Error).message || err) }));
      console.log(`[aiAgent] tool ${fc.name}`, JSON.stringify(fc.args || {}).slice(0, 120));
      contents.push({ role: 'user', parts: [{ functionResponse: { name: fc.name, response: result } }] });
    }
  }
  return null;
}

// ── Loop do agente via Claude (Anthropic Messages API + tool use) ───────────
async function callClaudeAgent(
  message: string,
  systemPrompt: string,
  key: string,
  model: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
  ids: AgentIds,
  collector: { media: AgentMedia[] },
): Promise<string | null> {
  const client = anthropicClient(key);
  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map(turn => ({
      role:    turn.role === 'user' ? 'user' as const : 'assistant' as const,
      content: turn.content,
    })),
    { role: 'user', content: message },
  ];

  for (let round = 0; round < 4; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 600,
      system:     systemPrompt,
      messages,
      tools:      ANTHROPIC_TOOLS,
    }, { timeout: 25_000 });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('').trim();
      return text || null;
    }

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      bumpUsage('toolCalls');
      const result = await executeTool(tu.name, (tu.input || {}) as Record<string, unknown>, ids, collector)
        .catch(err => ({ erro: String((err as Error).message || err) }));
      console.log(`[aiAgent] tool ${tu.name}`, JSON.stringify(tu.input || {}).slice(0, 120));
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: results });
  }
  return null;
}

// Claude sem ferramentas (one-shot — teste de conexão e modo simples)
async function callClaude(
  message: string,
  systemPrompt: string,
  key: string,
  model: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  const response = await anthropicClient(key).messages.create({
    model,
    max_tokens: 400,
    system:     systemPrompt,
    messages: [
      ...(history ?? []).map(turn => ({
        role:    turn.role === 'user' ? 'user' as const : 'assistant' as const,
        content: turn.content,
      })),
      { role: 'user', content: message },
    ],
  }, { timeout: 15_000 });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('').trim() || null;
}

// ── Completação simples e barata (memória de leads, resumos internos) ───────
// Roteia pelo provider configurado; usada pelo leadMemoryService.
export async function simpleCompletion(prompt: string, maxTokens = 250): Promise<string | null> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  if (!key) return null;

  try {
    if (provider === 'anthropic') {
      const model = process.env.AI_ASSIST_MODEL || 'claude-haiku-4-5';
      const r = await anthropicClient(key).messages.create({
        model, max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }, { timeout: 15_000 });
      return r.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('').trim() || null;
    }
    if (provider === 'gemini') {
      const model = process.env.AI_ASSIST_MODEL_FALLBACK || 'gemini-2.0-flash';
      const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const resp  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents:         [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
      const json = await resp.json() as Record<string, any>;
      return (json?.candidates?.[0]?.content?.parts || [])
        .map((p: Record<string, any>) => p.text).filter(Boolean).join('').trim() || null;
    }
    return null;
  } catch (err) {
    bumpUsage('errors');
    console.error('[AI Assist] simpleCompletion:', (err as Error).message);
    return null;
  }
}

// ── Transcrição de áudio (WhatsApp voice notes) via Gemini multimodal ───────
export async function transcribeAudio(audio: Buffer, mimeType = 'audio/ogg'): Promise<string | null> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  // Claude não transcreve áudio — com provider anthropic, usa GEMINI_KEY
  // separada (free tier aguenta: transcrição é esporádica e leve).
  const key = provider === 'gemini'
    ? (process.env.AI_ASSIST_KEY || '')
    : (process.env.GEMINI_KEY || '');
  const model = provider === 'gemini'
    ? (process.env.AI_ASSIST_MODEL || 'gemini-2.5-flash')
    : 'gemini-2.0-flash';
  if (!key) return null;
  if (audio.length > 8 * 1024 * 1024) return null; // grande demais para inline

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mimeType.split(';')[0], data: audio.toString('base64') } },
        { text: 'Transcreva este áudio em português do Brasil. Responda SOMENTE com a transcrição, sem comentários.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 600, temperature: 0 },
  };

  try {
    bumpUsage('transcriptions');
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const json = await resp.json() as Record<string, any>;
    const text = (json?.candidates?.[0]?.content?.parts || [])
      .map((p: Record<string, any>) => p.text).filter(Boolean).join('').trim();
    return text || null;
  } catch (err) {
    bumpUsage('errors');
    console.error('[AI Assist] transcrição:', (err as Error).message);
    return null;
  }
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
    generationConfig:  {
      maxOutputTokens: 300,
      temperature: 0.5,
      ...(model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
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
  const model    = process.env.AI_ASSIST_MODEL || 'gemini-2.5-flash';

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
    if (provider === 'anthropic') {
      const claudeModel = process.env.AI_ASSIST_MODEL || 'claude-haiku-4-5';
      const reply = await callClaude(
        'Responda apenas: "IA Generativa funcionando corretamente."',
        'Você é um assistente de teste. Responda exatamente o que for pedido, em português.',
        key,
        claudeModel,
      );
      return { ok: true, reply: reply || 'Resposta vazia.', provider, model: claudeModel };
    }
    return { ok: false, error: `Provider "${provider}" não suportado. Use: gemini ou anthropic.` };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes('TimeoutError') || msg.includes('timeout')) {
      return { ok: false, error: 'Timeout: API não respondeu em 8s. Verifique a chave.', provider, model };
    }
    return { ok: false, error: msg, provider, model };
  }
}

// ── Função principal chamada pelo motor do bot ───────────────────────────────
// Com `ids` (storeId+phone) roda em MODO AGENTE: ferramentas de catálogo/CRM/
// venda via function calling; fotos de produto voltam em `media`. Sem `ids`,
// mantém o modo one-shot original. Em erro (429/5xx/timeout) tenta o fallback.
export async function aiAssistFull(
  message: string,
  ctx: AiAssistContext,
  intentHint?: string,
  ids?: AgentIds,
): Promise<AiAssistResult> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  const primary  = process.env.AI_ASSIST_MODEL || 'gemini-2.5-flash';
  const fallback = process.env.AI_ASSIST_MODEL_FALLBACK || 'gemini-2.0-flash';

  if (!key) return { text: null, media: [] };

  const systemPrompt = createSystemPrompt(ctx, intentHint) + (ids ? TOOLS_NOTE : '');

  // ── Provider: Claude (Anthropic) ───────────────────────────────────────────
  if (provider === 'anthropic') {
    const model = process.env.AI_ASSIST_MODEL || 'claude-haiku-4-5';
    const collector = { media: [] as AgentMedia[] };
    try {
      bumpUsage('calls');
      const text = ids
        ? await callClaudeAgent(message, systemPrompt, key, model, ctx.conversationHistory, ids, collector)
        : await callClaude(message, systemPrompt, key, model, ctx.conversationHistory);
      return { text, media: collector.media };
    } catch (err) {
      bumpUsage('errors');
      console.error(`[AI Assist] ${model}:`, (err as Error).message);
      return { text: null, media: [] };
    }
  }

  if (provider !== 'gemini') return { text: null, media: [] };
  const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

  for (let i = 0; i < models.length; i++) {
    const collector = { media: [] as AgentMedia[] };
    try {
      bumpUsage('calls');
      if (i > 0) bumpUsage('fallbacks');
      const text = ids
        ? await callGeminiAgent(message, systemPrompt, key, models[i], ctx.conversationHistory, ids, collector)
        : await callGemini(message, systemPrompt, key, models[i], ctx.conversationHistory);
      return { text, media: collector.media };
    } catch (err) {
      bumpUsage('errors');
      console.error(`[AI Assist] ${models[i]}:`, (err as Error).message);
      // tenta o próximo modelo da lista
    }
  }
  return { text: null, media: [] };
}

// Compatibilidade: retorna só o texto (rotas antigas/testes)
export async function aiAssist(
  message: string,
  ctx: AiAssistContext,
  intentHint?: string,
  ids?: AgentIds,
): Promise<string | null> {
  const result = await aiAssistFull(message, ctx, intentHint, ids);
  return result.text;
}

// ── Visão: descreve foto enviada pelo cliente (busca de produto por imagem) ─
export async function describeImage(image: Buffer, mimeType = 'image/jpeg'): Promise<string | null> {
  const provider = (process.env.AI_ASSIST_PROVIDER || '').toLowerCase();
  const key      = process.env.AI_ASSIST_KEY || '';
  if (!key) return null;
  if (image.length > 8 * 1024 * 1024) return null;

  const VISION_PROMPT = 'Foto enviada por um cliente de uma loja de roupas no WhatsApp. Descreva em UMA frase curta o que ele quer (tipo de peça, cor, marca/estampa se visível). Responda SOMENTE com a descrição.';

  // Claude tem visão nativa — provider anthropic descreve direto
  if (provider === 'anthropic') {
    try {
      const model = process.env.AI_ASSIST_MODEL || 'claude-haiku-4-5';
      const media = mimeType.split(';')[0];
      const okTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const r = await anthropicClient(key).messages.create({
        model, max_tokens: 100,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: (okTypes.includes(media) ? media : 'image/jpeg') as 'image/jpeg', data: image.toString('base64') } },
            { type: 'text', text: VISION_PROMPT },
          ],
        }],
      }, { timeout: 15_000 });
      return r.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('').trim() || null;
    } catch (err) {
      bumpUsage('errors');
      console.error('[AI Assist] visão (claude):', (err as Error).message);
      return null;
    }
  }

  if (provider !== 'gemini') return null;
  const model = process.env.AI_ASSIST_MODEL || 'gemini-2.5-flash';

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mimeType.split(';')[0], data: image.toString('base64') } },
        { text: 'Foto enviada por um cliente de uma loja de roupas no WhatsApp. Descreva em UMA frase curta o que ele quer (tipo de peça, cor, marca/estampa se visível). Responda SOMENTE com a descrição.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 100, temperature: 0.2 },
  };

  try {
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const json = await resp.json() as Record<string, any>;
    const text = (json?.candidates?.[0]?.content?.parts || [])
      .map((p: Record<string, any>) => p.text).filter(Boolean).join('').trim();
    return text || null;
  } catch (err) {
    bumpUsage('errors');
    console.error('[AI Assist] visão:', (err as Error).message);
    return null;
  }
}
