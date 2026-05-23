// =============================================================================
//  MAPA COMERCIAL DO BOT — Funil de vendas Fluxo Outlet
// =============================================================================
//
//  INICIO (detecta origem na 1ª mensagem)
//  ├── camisa/polo/malha  → CAPTURA_TAMANHO
//  ├── tenis              → CAPTURA_NUMERO
//  ├── bermuda            → CAPTURA_TAMANHO
//  ├── promocao           → CAPTURA_TAMANHO  (urgência)
//  ├── pedido             → CONSULTA_PEDIDO → ENCAMINHAR_HUMANO
//  ├── atendente          → SUPORTE  [terminal]
//  └── *                  → APRESENTACAO → CAPTURA_TAMANHO/NUMERO/NAO_ENTENDI
//
//  CAPTURA_TAMANHO → CAPTURA_ESTILO ──┐
//                                      ├→ CAPTURA_CIDADE → RECOMENDACAO
//  CAPTURA_NUMERO  ───────────────────┘
//
//  RECOMENDACAO
//  ├── quanto/foto/quero/atendente → CAPTURA_NOME_QUENTE → ENCAMINHAR_HUMANO [terminal]
//  └── barata/premium              → AGUARDAR_RESPOSTA   → ENCAMINHAR_HUMANO [terminal]
//
//  Para expandir o funil: adicione nós e opções aqui.
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
  | 'NAO_ENTENDI';

export type NodeAction =
  | 'save_nome'
  | 'save_tamanho'
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
    message: (ctx) => {
      if (ctx.origem === 'camisa')
        return `Vi que você veio pelas camisas da Fluxo 👕\nQual tamanho você usa: P, M, G ou GG?`;
      if (ctx.origem === 'tenis')
        return `Vi que você veio pelos tênis 👟\nQual numeração você usa?`;
      if (ctx.origem === 'promocao')
        return `Você veio pela promoção da Fluxo 🔥\nMe fala seu tamanho que eu te mostro as peças que ainda estão disponíveis.`;
      return `Oi! 👋 Sou o assistente da *Fluxo Outlet*.\n\nO que você procura hoje?\n\n👕  Camisa / Polo\n👟  Tênis\n👖  Bermuda\n🔥  Promoção`;
    },
    options: [
      { trigger: /camis[ae]t?a?|polo|malha|camisinha/i,             next: 'CAPTURA_TAMANHO', data: { origem: 'camisa',   interesse: 'camisa'  } },
      { trigger: /t[êe]nis|cal[çc]ado|sapato|sneaker/i,             next: 'CAPTURA_NUMERO',  data: { origem: 'tenis',   interesse: 'tenis'   } },
      { trigger: /bermuda|short/i,                                    next: 'CAPTURA_TAMANHO', data: { origem: 'bermuda', interesse: 'bermuda' } },
      { trigger: /promo[çc][ãa]o?|promo\b|oferta|desconto/i,        next: 'CAPTURA_TAMANHO', data: { origem: 'promocao'                       } },
      { trigger: /pedido|status\b|rastrear|n[úu]mero\b/i,           next: 'CONSULTA_PEDIDO'                                                     },
      { trigger: /atendente|humano|ajuda|suporte|falar com|pessoa/i, next: 'SUPORTE'                                                              },
    ],
    default: 'APRESENTACAO',
  },

  APRESENTACAO: {
    id: 'APRESENTACAO',
    message: `Me fala o que você procura hoje:\n\n👕  Camisa, polo ou malha\n👟  Tênis ou calçado\n👖  Bermuda\n\nDigita aí 👇`,
    options: [
      { trigger: /camis[ae]t?a?|polo|malha/i, next: 'CAPTURA_TAMANHO', data: { origem: 'camisa',   interesse: 'camisa'  } },
      { trigger: /t[êe]nis|cal[çc]ado/i,      next: 'CAPTURA_NUMERO',  data: { origem: 'tenis',   interesse: 'tenis'   } },
      { trigger: /bermuda|short/i,             next: 'CAPTURA_TAMANHO', data: { origem: 'bermuda', interesse: 'bermuda' } },
    ],
    default: 'NAO_ENTENDI',
  },

  // ── QUALIFICAÇÃO: ROUPA ───────────────────────────────────────────────────
  CAPTURA_TAMANHO: {
    id: 'CAPTURA_TAMANHO',
    message: (ctx) =>
      ctx.origem === 'promocao'
        ? `Me fala seu tamanho que eu te mostro as peças disponíveis:\n*P  ·  M  ·  G  ·  GG*`
        : `Boa. Qual tamanho você usa?\n*P  ·  M  ·  G  ·  GG*`,
    action: 'save_tamanho',
    default: 'CAPTURA_ESTILO',
  },

  CAPTURA_ESTILO: {
    id: 'CAPTURA_ESTILO',
    message: (ctx) =>
      ctx.interesse === 'bermuda'
        ? `Certo! Você prefere bermuda *jeans*, *tactel* ou *moletom*?`
        : `Fechado. Você prefere *camiseta básica*, *polo* ou *malha premium*?`,
    action: 'save_estilo',
    default: 'CAPTURA_CIDADE',
  },

  // ── QUALIFICAÇÃO: TÊNIS ───────────────────────────────────────────────────
  CAPTURA_NUMERO: {
    id: 'CAPTURA_NUMERO',
    message: `Qual numeração você usa? _(ex: 39, 40, 41, 42...)_`,
    action: 'save_tamanho',
    default: 'CAPTURA_CIDADE',
  },

  // ── QUALIFICAÇÃO: LOCALIZAÇÃO ─────────────────────────────────────────────
  CAPTURA_CIDADE: {
    id: 'CAPTURA_CIDADE',
    message: `Perfeito. Você está em *Uberaba* ou é envio para outra cidade?`,
    action: 'save_cidade',
    default: 'RECOMENDACAO',
  },

  // ── RECOMENDAÇÃO DE PRODUTOS ──────────────────────────────────────────────
  RECOMENDACAO: {
    id: 'RECOMENDACAO',
    message: (ctx) => {
      const tam = ctx.tamanho || 'M';
      if (ctx.interesse === 'tenis') {
        return (
          `Tenho 3 opções no número *${tam}*:\n\n` +
          `1. Tênis casual ${tam} — visual limpo e versátil\n` +
          `2. Tênis esportivo ${tam} — ideal pro dia a dia\n` +
          `3. Lifestyle premium ${tam} — o favorito do momento 🔥\n\n` +
          `Quer o *mais barato* ou o *mais premium*?\nOu já decidiu? Só falar *"quero"* 💪`
        );
      }
      const p1 = ctx.estilo?.includes('polo') ? `Polo preta ${tam}` : ctx.estilo?.includes('malha') ? `Malha premium branca ${tam}` : `Básica premium preta ${tam}`;
      return (
        `Tenho 3 opções no tamanho *${tam}*:\n\n` +
        `1. ${p1} — visual mais arrumado\n` +
        `2. Malha premium branca ${tam} — leve e versátil\n` +
        `3. Básica premium ${tam} — melhor custo-benefício\n\n` +
        `Quer a *mais barata* ou a *mais premium*?\nOu já foi convencido? Só falar *"quero"* 💪`
      );
    },
    action: 'register_lead',
    options: [
      { trigger: /quanto|pre[çc]o|custa|valor|paga/i,                     next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto' } },
      { trigger: /foto|ver|mostra|manda|envia/i,                           next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto' } },
      { trigger: /quero\b|vou pegar|vou levar|fechado|quero esse|comprar/i, next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano'      } },
      { trigger: /atendente|humano|falar|chamar|pessoa/i,                  next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano'      } },
      { trigger: /mais barata|barato|econom|em conta/i,                    next: 'AGUARDAR_RESPOSTA',   data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto', preferencia: 'barata'  } },
      { trigger: /mais premium|cara\b|top\b|melhor\b|luxo/i,              next: 'AGUARDAR_RESPOSTA',   data: { status_comercial: 'QUENTE', proxima_acao: 'recomendar_produto', preferencia: 'premium' } },
    ],
    default: 'AGUARDAR_RESPOSTA',
  },

  // ── LEADS QUENTES: CAPTURA DO NOME ────────────────────────────────────────
  CAPTURA_NOME_QUENTE: {
    id: 'CAPTURA_NOME_QUENTE',
    message: (ctx) =>
      ctx.proxima_acao === 'chamar_humano'
        ? `Perfeito. Vou chamar um atendente da Fluxo pra te mandar as melhores opções agora. 🙋\n\nQual é o seu nome?`
        : `Boa! Para te passar o valor e disponibilidade, qual é o seu nome?`,
    action: 'save_nome',
    default: 'ENCAMINHAR_HUMANO',
  },

  AGUARDAR_RESPOSTA: {
    id: 'AGUARDAR_RESPOSTA',
    message: (ctx) => {
      const tam = ctx.tamanho || 'M';
      const pref = ctx.preferencia;
      if (ctx.interesse === 'tenis') {
        const prod = pref === 'premium' ? `Lifestyle premium ${tam}` : `Tênis casual ${tam}`;
        return `Boa escolha! Tenho o *${prod}* disponível.\n\nPara te enviar foto e valor, qual é o seu nome?`;
      }
      const prod = pref === 'premium' ? `Malha premium branca ${tam}` : `Básica premium ${tam}`;
      return `Perfeito! Tenho a *${prod}* aqui.\n\nPara te enviar foto e valor, qual é o seu nome?`;
    },
    action: 'save_nome',
    default: 'ENCAMINHAR_HUMANO',
  },

  // ── FLUXO DE PEDIDO / SUPORTE ─────────────────────────────────────────────
  CONSULTA_PEDIDO: {
    id: 'CONSULTA_PEDIDO',
    message: `Sem problema! Me informe o número do seu pedido:\n_(ex: #12345)_`,
    default: 'ENCAMINHAR_HUMANO',
  },

  SUPORTE: {
    id: 'SUPORTE',
    message: (ctx) =>
      `Claro! Conectando com atendente da *Fluxo Outlet* agora. 🙋\n\n${ctx.wa_link || ''}`,
    action: 'generate_wa_link',
    terminal: true,
  },

  // ── TERMINAL: ENCAMINHAMENTO HUMANO ──────────────────────────────────────
  ENCAMINHAR_HUMANO: {
    id: 'ENCAMINHAR_HUMANO',
    message: (ctx) =>
      `Perfeito${ctx.nome ? `, *${ctx.nome.split(' ')[0]}*` : ''}! 🙌\n\n` +
      `Vou chamar um atendente da *Fluxo Outlet* para te mandar as melhores opções agora.\n\n` +
      `Ou fale diretamente:\n${ctx.wa_link || ''}`,
    action: 'register_lead',
    terminal: true,
  },

  // ── FALLBACK ──────────────────────────────────────────────────────────────
  NAO_ENTENDI: {
    id: 'NAO_ENTENDI',
    message: `Hmm, não entendi 😅\n\nMe fala o que você procura:\n\n👕  Camisa, polo ou malha\n👟  Tênis\n👖  Bermuda`,
    default: 'INICIO',
  },
};
