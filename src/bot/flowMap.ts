// =============================================================================
//  MAPA BASE DO BOT — Funil genérico multi-tenant
//
//  Este flowMap é neutro e serve como fallback para qualquer tipo de negócio.
//  Customizações por loja são aplicadas via bot_flow_config (presets de cadastro
//  ou edições manuais no painel). A engine usa bot_flow_config como camada
//  acima deste mapa, então qualquer nó aqui pode ser sobrescrito por loja.
//
//  INICIO → APRESENTACAO → CAPTURA_TAMANHO → CAPTURA_ESTILO → CAPTURA_CIDADE
//         → RECOMENDACAO → CAPTURA_NOME_QUENTE → ENCAMINHAR_HUMANO [terminal]
// =============================================================================

export type NodeId =
  | 'INICIO'
  | 'APRESENTACAO'
  | 'CAPTURA_TAMANHO'
  | 'CAPTURA_NUMERO'
  | 'CAPTURA_ESTILO'
  | 'CAPTURA_CIDADE'
  | 'RECOMENDACAO'
  | 'CAPTURA_NOME_QUENTE'
  | 'AGUARDAR_RESPOSTA'
  | 'CONSULTA_PEDIDO'
  | 'SUPORTE'
  | 'ENCAMINHAR_HUMANO'
  | 'FORA_HORARIO'
  | 'OPTOUT'
  | 'NAO_ENTENDI';

export type NodeAction =
  | 'save_nome'
  | 'save_tamanho'
  | 'save_numero_pedido'
  | 'save_estilo'
  | 'save_cidade'
  | 'register_lead'
  | 'generate_wa_link';

export interface FlowOption {
  trigger: RegExp;
  next: NodeId;
  data?: Record<string, string>;
}

export interface FlowNode {
  id: NodeId;
  message: string | ((ctx: Record<string, string>) => string);
  options?: FlowOption[];
  default?: NodeId;
  action?: NodeAction;
  terminal?: boolean;
}

export const FLOW_MAP: Record<NodeId, FlowNode> = {

  // ── ENTRADA ───────────────────────────────────────────────────────────────
  INICIO: {
    id: 'INICIO',
    message: (ctx) => ctx._saudacao || `Oi! 👋 Sou o assistente da *${ctx._storeName || 'nossa loja'}*.\n\nComo posso te ajudar hoje?`,
    options: [
      { trigger: /pedido|status\b|rastrear|n[úu]mero\b/i,           next: 'CONSULTA_PEDIDO' },
      { trigger: /atendente|humano|ajuda|suporte|falar com|pessoa/i, next: 'SUPORTE'         },
    ],
    default: 'APRESENTACAO',
  },

  APRESENTACAO: {
    id: 'APRESENTACAO',
    message: `Como posso te ajudar hoje?\n\nDescreve o que você precisa e eu te direciono. 👇`,
    options: [],
    default: 'CAPTURA_TAMANHO',
  },

  // ── QUALIFICAÇÃO ─────────────────────────────────────────────────────────
  CAPTURA_TAMANHO: {
    id: 'CAPTURA_TAMANHO',
    message: `Pode me dar mais detalhes sobre o que você precisa?`,
    action: 'save_tamanho',
    default: 'CAPTURA_ESTILO',
  },

  CAPTURA_ESTILO: {
    id: 'CAPTURA_ESTILO',
    message: `Tem algum detalhe adicional que devo saber?`,
    action: 'save_estilo',
    default: 'CAPTURA_CIDADE',
  },

  CAPTURA_NUMERO: {
    id: 'CAPTURA_NUMERO',
    message: `Pode me informar mais detalhes?`,
    action: 'save_tamanho',
    default: 'CAPTURA_CIDADE',
  },

  CAPTURA_CIDADE: {
    id: 'CAPTURA_CIDADE',
    message: `Qual o seu nome para eu já deixar registrado?`,
    action: 'save_cidade',
    default: 'RECOMENDACAO',
  },

  // ── LEAD CAPTURE ─────────────────────────────────────────────────────────
  RECOMENDACAO: {
    id: 'RECOMENDACAO',
    message: `Obrigado pelas informações! Vou chamar um atendente para te ajudar da melhor forma. 🙋\n\nQual é o seu nome?`,
    action: 'register_lead',
    options: [
      { trigger: /quanto|pre[çc]o|custa|valor|paga/i,                      next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto' } },
      { trigger: /foto|ver|mostra|manda|envia/i,                            next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto' } },
      { trigger: /quero\b|vou pegar|vou levar|fechado|quero esse|comprar/i, next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano'      } },
      { trigger: /atendente|humano|falar|chamar|pessoa/i,                   next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano'      } },
    ],
    default: 'CAPTURA_NOME_QUENTE',
  },

  CAPTURA_NOME_QUENTE: {
    id: 'CAPTURA_NOME_QUENTE',
    message: (ctx) =>
      ctx.proxima_acao === 'chamar_humano'
        ? `Perfeito. Vou chamar um atendente da ${ctx._storeName || 'loja'} agora. 🙋\n\nQual é o seu nome?`
        : `Boa! Para te passar mais informações, qual é o seu nome?`,
    action: 'save_nome',
    default: 'ENCAMINHAR_HUMANO',
  },

  AGUARDAR_RESPOSTA: {
    id: 'AGUARDAR_RESPOSTA',
    message: `Perfeito! Para te enviar as informações, qual é o seu nome?`,
    action: 'save_nome',
    default: 'ENCAMINHAR_HUMANO',
  },

  // ── FLUXO DE PEDIDO / SUPORTE ─────────────────────────────────────────────
  CONSULTA_PEDIDO: {
    id: 'CONSULTA_PEDIDO',
    message: `Sem problema! Me informe o número do seu pedido:\n_(ex: #12345)_`,
    action: 'save_numero_pedido',
    default: 'ENCAMINHAR_HUMANO',
  },

  SUPORTE: {
    id: 'SUPORTE',
    message: (ctx) =>
      `Claro! Conectando com atendente da *${ctx._storeName || 'nossa loja'}* agora. 🙋\n\n${ctx.wa_link || ''}`,
    action: 'generate_wa_link',
    terminal: true,
  },

  // ── TERMINAL: ENCAMINHAMENTO HUMANO ──────────────────────────────────────
  ENCAMINHAR_HUMANO: {
    id: 'ENCAMINHAR_HUMANO',
    message: (ctx) =>
      `Perfeito${ctx.nome ? `, *${ctx.nome.split(' ')[0]}*` : ''}! 🙌\n\n` +
      `Vou chamar um atendente da *${ctx._storeName || 'nossa loja'}* para te mandar as melhores opções agora.\n\n` +
      `Ou fale diretamente:\n${ctx.wa_link || ''}`,
    action: 'register_lead',
    terminal: true,
  },

  // ── FALLBACK ──────────────────────────────────────────────────────────────
  NAO_ENTENDI: {
    id: 'NAO_ENTENDI',
    message: `Hmm, não entendi muito bem 😅\n\nPode repetir ou me falar de outra forma?`,
    default: 'APRESENTACAO',
  },

  // ── FORA DO HORÁRIO DE ATENDIMENTO ────────────────────────────────────────
  FORA_HORARIO: {
    id: 'FORA_HORARIO',
    message: (ctx) =>
      `Oi! 👋 No momento estamos fora do horário de atendimento.\n\n` +
      `Retornamos no próximo dia útil às *${ctx._abertura || '09:00'}* 🕑\n\n` +
      `Deixa sua mensagem aqui que respondemos assim que abrirmos! 😊`,
    default: 'INICIO',
  },

  // ── OPT-OUT (LGPD) ────────────────────────────────────────────────────────
  OPTOUT: {
    id: 'OPTOUT',
    message: (ctx) =>
      `Tudo certo! ✅ Seus dados foram removidos e você não receberá mais mensagens automáticas da *${ctx._storeName || 'nossa loja'}*.\n\n` +
      `Para voltar a interagir a qualquer momento, basta nos mandar um "oi". 👋`,
    terminal: true,
  },
};
