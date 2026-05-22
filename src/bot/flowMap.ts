// =============================================================================
//  MAPA MENTAL DO BOT — Árvore de decisão completa
// =============================================================================
//
//  INICIO
//  ├── "1" / catálogo / produtos    → CATALOGO
//  ├── "2" / pedido / status        → CONSULTA_PEDIDO
//  ├── "3" / ajuda / atendente      → SUPORTE
//  └── *                            → NAO_ENTENDI → (volta) INICIO
//
//  CATALOGO
//  └── (recebe resposta) ──────────→ QUALIFICACAO_NOME   [action: save_name]
//
//  QUALIFICACAO_NOME
//  └── (recebe nome) ──────────────→ QUALIFICACAO_INTERESSE [action: save_interest]
//
//  QUALIFICACAO_INTERESSE
//  └── (recebe interesse) ─────────→ LEAD_REGISTRADO  [action: register_lead]
//
//  LEAD_REGISTRADO
//  └── (automático) ───────────────→ ENCAMINHAR_HUMANO [action: generate_wa_link]
//
//  ENCAMINHAR_HUMANO  [terminal → reinicia em INICIO]
//
//  CONSULTA_PEDIDO
//  └── (recebe número) ────────────→ ENCAMINHAR_HUMANO
//
//  SUPORTE            [action: generate_wa_link]
//  └── (automático) ───────────────→ ENCAMINHAR_HUMANO [terminal]
//
//  NAO_ENTENDI
//  └── (automático) ───────────────→ INICIO
//
// =============================================================================

export type NodeId =
  | 'INICIO'
  | 'CATALOGO'
  | 'QUALIFICACAO_NOME'
  | 'QUALIFICACAO_INTERESSE'
  | 'LEAD_REGISTRADO'
  | 'ENCAMINHAR_HUMANO'
  | 'CONSULTA_PEDIDO'
  | 'SUPORTE'
  | 'NAO_ENTENDI';

export type NodeAction =
  | 'save_name'
  | 'save_interest'
  | 'register_lead'
  | 'generate_wa_link';

export interface FlowOption {
  trigger: RegExp;
  next: NodeId;
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

  // ── NÍVEL 0: Entrada ─────────────────────────────────────────────────────
  INICIO: {
    id: 'INICIO',
    message: (ctx) =>
      `Olá${ctx.nome ? `, ${ctx.nome.split(' ')[0]}` : ''}! 👋 Bem-vindo(a)!\n\nComo posso te ajudar?\n\n1️⃣  Ver catálogo\n2️⃣  Status de pedido\n3️⃣  Falar com atendente`,
    options: [
      { trigger: /^1$|cat[áa]logo|produto|ver|quero ver/i,  next: 'CATALOGO' },
      { trigger: /^2$|pedido|status|compra|n[úu]mero/i,     next: 'CONSULTA_PEDIDO' },
      { trigger: /^3$|ajuda|suporte|atendente|humano|falar/, next: 'SUPORTE' },
    ],
    default: 'NAO_ENTENDI',
  },

  // ── NÍVEL 1A: Fluxo Catálogo ──────────────────────────────────────────────
  CATALOGO: {
    id: 'CATALOGO',
    message: 'Ótimo! Para te enviar as melhores opções, preciso de uma informação.\n\nQual é o seu nome?',
    default: 'QUALIFICACAO_NOME',
    action: 'save_name',
  },

  QUALIFICACAO_NOME: {
    id: 'QUALIFICACAO_NOME',
    message: (ctx) =>
      `Prazer, ${ctx.nome?.split(' ')[0] || 'você'}! 😊\n\nO que você está procurando?\n_(ex: camiseta, calça, tênis, kit...)_`,
    default: 'QUALIFICACAO_INTERESSE',
    action: 'save_interest',
  },

  QUALIFICACAO_INTERESSE: {
    id: 'QUALIFICACAO_INTERESSE',
    message: (ctx) =>
      `Anotei! Vou te conectar com nossa equipe agora.\n\n📋 *Resumo:*\n👤 ${ctx.nome || '—'}\n🛍 Interesse: ${ctx.interesse || '—'}\n\nPreparando atendimento...`,
    default: 'LEAD_REGISTRADO',
    action: 'register_lead',
  },

  LEAD_REGISTRADO: {
    id: 'LEAD_REGISTRADO',
    message: (ctx) =>
      `✅ Tudo certo, ${ctx.nome?.split(' ')[0] || 'você'}!\n\nUm atendente vai te chamar em breve.\n\nOu se preferir falar *agora*, clique aqui 👇\n${ctx.wa_link || ''}`,
    default: 'ENCAMINHAR_HUMANO',
    action: 'generate_wa_link',
    terminal: true,
  },

  // ── NÍVEL 1B: Fluxo Pedido ────────────────────────────────────────────────
  CONSULTA_PEDIDO: {
    id: 'CONSULTA_PEDIDO',
    message: 'Sem problema! Me informe o número do seu pedido:\n_(ex: #12345)_',
    default: 'ENCAMINHAR_HUMANO',
  },

  // ── NÍVEL 1C: Suporte direto ──────────────────────────────────────────────
  SUPORTE: {
    id: 'SUPORTE',
    message: 'Claro! Vou te conectar com um atendente agora. 🙋\n\nClique no link para falar diretamente:\n{wa_link}',
    action: 'generate_wa_link',
    default: 'ENCAMINHAR_HUMANO',
    terminal: true,
  },

  // ── TERMINAL: Encaminhamento ──────────────────────────────────────────────
  ENCAMINHAR_HUMANO: {
    id: 'ENCAMINHAR_HUMANO',
    message: (ctx) =>
      `🔗 Fale com nossa equipe agora:\n${ctx.wa_link || ''}\n\nQualquer dúvida, é só chamar! 😊`,
    terminal: true,
  },

  // ── FALLBACK ──────────────────────────────────────────────────────────────
  NAO_ENTENDI: {
    id: 'NAO_ENTENDI',
    message: 'Hmm, não entendi muito bem 😅\n\nTente uma dessas opções:\n\n1️⃣  Catálogo\n2️⃣  Status de pedido\n3️⃣  Falar com atendente',
    default: 'INICIO',
  },
};
