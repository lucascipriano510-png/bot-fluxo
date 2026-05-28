// ═══════════════════════════════════════════════════════════════
//  intentService — detecta a intenção real da mensagem do cliente
// ═══════════════════════════════════════════════════════════════

export type Intent =
  | 'humano'
  | 'orcamento'
  | 'compra'
  | 'identidade_loja'
  | 'conversa_geral'
  | 'duvida_operacional'
  | 'disponibilidade'
  | 'busca_item'
  | 'delivery'
  | 'hours'
  | 'location'
  | 'price'
  | 'catalog'
  | 'exchange'
  | 'payment'
  | 'greeting'
  | 'thanks'
  | 'farewell'
  | 'gift'
  | 'new_arrivals'
  | 'size_help'
  | 'price_sensitivity'
  | 'complaint'
  | 'wholesale'
  | 'unknown';

export interface IntentEntities {
  product?: string;
  size?: string;
  color?: string;
  location?: string;
}

export interface IntentResult {
  intent: Intent;
  confidence: number;
  entities?: IntentEntities;
}

interface IntentDef {
  intent: Intent;
  primary: RegExp[];   // qualquer match → confiança base 0.90
  secondary: RegExp[]; // qualquer match → confiança base 0.62
  priority: number;    // menor = maior prioridade em empates
}

// Remove acentos e normaliza para comparação
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

const INTENT_DEFS: IntentDef[] = [

  // ── 0. Identidade da loja ────────────────────────────────────
  {
    intent: 'identidade_loja',
    priority: 0,
    primary: [
      /\bvoc[eê]s? (s[aã]o|[ée]) (a |o |da |do )?\b/,
      /\b[ée] (a |o |da |do |de )?(loja|fluxo|outlet|empresa|marca|estabelecimento)\b/,
      /\bs[aã]o (a |o |da |do )?(loja|fluxo|outlet|empresa)\b/,
      /\b(que|qual) loja [ée]\b/,
      /\bessa loja [ée]\b/,
      /\bde onde (voc[eê]s?|vcs) s[aã]o\b/,
      /\bde (qual|que) cidade (voc[eê]s?|vcs)\b/,
      /\bde onde [ée]\b/,
      /\binstagram (de|da|do|d[ao]) (voc[eê]s?|loja)\b/,
      /\binstagram da loja\b/,
      /\bvoc[eê]s? t[eê]m instagram\b/,
      /\bqual (o )?instagram\b/,
      /\bquem [ée] voc[eê]s?\b/,
      /\bquem s[aã]o voc[eê]s?\b/,
      /\bvoc[eê]s? s[aã]o quem\b/,
      /\bquem fala\b/,
      /\bo que [ée] isso\b/,
      /\besse (bot|chat|sistema|atendimento) [ée]\b/,
      /\b[ée] (loja|real|oficial|verdade|confi[aá]vel)\b/,
      /\bda (qual|que) loja\b/,
    ],
    secondary: [
      /\bquem voc[eê]s?\b/,
      /\bonde fica a loja\b/,
      /\bsobre (a loja|voc[eê]s?)\b/,
      /\bfluxo outlet\b/,
      /\bque loja\b/,
      /\bqual loja\b/,
    ],
  },

  // ── 0. Conversa geral / Afirmação ────────────────────────────
  {
    intent: 'conversa_geral',
    priority: 0,
    primary: [
      /^(beleza|certo|entendi|ok|pode ser|tudo bem|show|perfeito|legal|ótimo|oba|fechado|blz|vlw|tá)[\s!.?]*$/i,
      /\bme ajuda (a[íi]|aqui)\b/,
      /\bpreciso de ajuda\b/,
      /\bn[aã]o sei (por onde|como|o que)\b/,
      /\bqualquer coisa (pode|basta)\b/,
      /\bpode me (ajudar|indicar|orientar)\b/,
    ],
    secondary: [
      /\bentendido\b/,
      /\bok!\b/,
      /\bcompreendi\b/,
    ],
  },

  // ── 0. Dúvida operacional (processo/fluxo geral) ─────────────
  {
    intent: 'duvida_operacional',
    priority: 0,
    primary: [
      /\bcomo (compro|comprar)\b/,
      /\bcomo fa[çc]o (para|pra) (pedir|comprar|fazer pedido)\b/,
      /\bcomo (funciona|funciona)\b/,
      /\bcomo funciona (o )?servi[çc]o\b/,
      /\bcomo (funciona|fa[çc]o|fazer) o pedido\b/,
      /\bcomo (funciona|fa[çc]o)\b/,
      /\bme explica como funciona\b/,
      /\bcomo (fa[çc]o|fa[çc]a) para (contratar|solicitar|agendar)\b/,
    ],
    secondary: [
      /\bcomo funciona\b/,
      /\bcomo (fa[çc]o|fazer)\b/,
      /\bpasso a passo\b/,
    ],
  },

  // ── 0. Atendimento humano ────────────────────────────────────
  {
    intent: 'humano',
    priority: 0,
    primary: [
      /\batendente\b/,
      /\bfalar com (uma? )?pessoa\b/,
      /\bquero (falar com\s)?(um\s)?humano\b/,
      /\bchamar (um\s)?atendente\b/,
      /\bfalar com (um\s)?vendedor\b/,
      /\bme passa para (um\s)?atendente\b/,
      /\bquero atendimento (humano|pessoal)\b/,
      /\bfale com (um\s)?humano\b/,
    ],
    secondary: [
      /\bhumano\b/,
      /\bvendedor\b/,
      /\bfalar com\b/,
    ],
  },

  // ── 0. Orçamento / Sob medida ────────────────────────────────
  {
    intent: 'orcamento',
    priority: 1,
    primary: [
      /\bor[çc]amento\b/,
      /\bquero or[çc]ar\b/,
      /\bsob medida\b/,
      /\bme d[aá] (um\s)?or[çc]amento\b/,
      /\bquanto fica (para|pra) fazer\b/,
      /\bprecisa de or[çc]amento\b/,
      /\bor[çc]ar (um|uma)\b/,
    ],
    secondary: [
      /\bor[çc]ar\b/,
      /\bpersonaliz\b/,
      /\bsob encomenda\b/,
    ],
  },

  // ── 0. Intenção de compra ────────────────────────────────────
  {
    intent: 'compra',
    priority: 2,
    primary: [
      /\bquero comprar\b/,
      /\bvou (comprar|levar|pegar|fechar)\b/,
      /\bquero (esse|essa|este|esta)\b/,
      /\bquero fazer (um\s)?pedido\b/,
      /\bcomo (fa[çc]o|fazer) (para|pra) (comprar|pedir)\b/,
      /\bquero (levar|pegar|fechar)\b/,
    ],
    secondary: [
      /\bcomprar\b/,
      /\bpedido\b/,
      /\bfechar\b/,
      /\bvou levar\b/,
    ],
  },

  // ── 0. Disponibilidade ───────────────────────────────────────
  {
    intent: 'disponibilidade',
    priority: 3,
    primary: [
      /\bdispon[ií]vel\b/,
      /\btem (estoque|hor[aá]rio|vagas?)\b/,
      /\bainda tem\b/,
      /\bconsegue (hoje|amanha)\b/,
      /\btem para (hoje|amanha|essa semana)\b/,
      /\btem (vaga|hor[aá]rio) (livre|disponivel|vago)\b/,
    ],
    secondary: [
      /\bestoque\b/,
      /\bdisponibilidade\b/,
      /\bvaga\b/,
    ],
  },

  // ── 0. Busca de item / serviço ───────────────────────────────
  {
    intent: 'busca_item',
    priority: 4,
    primary: [
      /\bvoc[eê]s? (t[eê]m|fazem|oferecem)\b/,
      /\btem servi[çc]o de\b/,
      /\bquais (s[aã]o\s)?(os\s+)?(servi[çc]os|produtos|op[çc][oõ]es|planos)\b/,
      /\bo que voc[eê]s? (oferecem|t[eê]m)\b/,
      /\bquero ver (o que|os servi[çc]os|as op[çc][oõ]es)\b/,
    ],
    secondary: [
      /\bo que tem\b/,
      /\bop[çc][oõ]es\b/,
      /\bcatalogo de servi[çc]os\b/,
    ],
  },

  // ── 1. Entrega / Frete ───────────────────────────────────────
  {
    intent: 'delivery',
    priority: 1,
    primary: [
      /\bentrega[ms]?\b/,
      /\bfaz(em)? entrega\b/,
      /\btem entrega\b/,
      /\bfrete\b/,
      /\benvio[s]?\b/,
      /\benviam?\b/,
      /\benviar\b/,
      /\bcorreio[s]?\b/,
      /\bmotoboy\b/,
      /\bentregar\b/,
    ],
    secondary: [
      /\bprazo\b/,
      /\breceber em casa\b/,
      /\brecebo em casa\b/,
      /\bchegar(a)? em\b/,
      /\btodo (o )?brasil\b/,
    ],
  },

  // ── 2. Horário de funcionamento ──────────────────────────────
  {
    intent: 'hours',
    priority: 2,
    primary: [
      /\bhorario\b/,
      /\bque horas\b/,
      /\babre (hoje|amanha|quando|cedo|mais tarde)\b/,
      /\bfecha (quando|hoje|cedo)\b/,
      /\bfunciona (hoje|amanha)\b/,
      /\best[aá] aberto\b/,
      /\bta aberto\b/,
      /\bhorario de (funcionamento|atendimento)\b/,
    ],
    secondary: [
      /\babre\b/,
      /\bfecha\b/,
      /\bfunciona\b/,
      /\baberto\b/,
      /\bfuncionamento\b/,
      /\batendimento\b/,
    ],
  },

  // ── 3. Localização ───────────────────────────────────────────
  {
    intent: 'location',
    priority: 3,
    primary: [
      /\bonde fica\b/,
      /\bendereco\b/,
      /\bloja (fisica|presencial)\b/,
      /\bposso retirar\b/,
      /\bpegar na loja\b/,
      /\bbuscar na loja\b/,
      /\btem loja fisica\b/,
      /\bretirar (na loja|pessoalmente)\b/,
    ],
    secondary: [
      /\bretirar\b/,
      /\bfisica\b/,
      /\bpresencial\b/,
      /\blocaliz(acao|ar)\b/,
    ],
  },

  // ── 4. Troca / Devolução ─────────────────────────────────────
  {
    intent: 'exchange',
    priority: 4,
    primary: [
      /\btroc[ae]\b/,
      /\btrocar\b/,
      /\bpode trocar\b/,
      /\bse nao servir\b/,
      /\bdevolucao\b/,
      /\bdevolver\b/,
      /\btamanho errado\b/,
      /\bquero trocar\b/,
    ],
    secondary: [
      /\bgarantia\b/,
      /\bveio errado\b/,
      /\bnao serviu\b/,
      /\bnao servir\b/,
    ],
  },

  // ── 5. Formas de pagamento ───────────────────────────────────
  {
    intent: 'payment',
    priority: 5,
    primary: [
      /\bpix\b/,
      /\bcartao\b/,
      /\bboleto\b/,
      /\bparcel(ado|amento|ar|a)\b/,
      /\bcomo (pago|pagar|pague)\b/,
      /\bformas? de pagamento\b/,
      /\bdebito\b/,
      /\baceita (pix|cartao|boleto)\b/,
      /\bcredito\b/,
    ],
    secondary: [
      /\bpagamento\b/,
      /\bpagar\b/,
    ],
  },

  // ── 6. Reclamação / Problema ─────────────────────────────────
  {
    intent: 'complaint',
    priority: 6,
    primary: [
      /\bproblema com (o )?pedido\b/,
      /\bveio (com defeito|errado|diferente|trocado)\b/,
      /\bcheou (errado|diferente)\b/,
      /\bproduto (com defeito|errado|diferente|ruim|pessimo)\b/,
      /\breclamacao\b/,
      /\breclamar\b/,
      /\binsatisfeit[oa]\b/,
      /\bquero reclamar\b/,
    ],
    secondary: [
      /\bdefeito\b/,
      /\bruim\b/,
      /\bpessimo\b/,
      /\bsacanagem\b/,
      /\bhorr[íi]vel\b/,
      /\babsurdo\b/,
      /\bque raiva\b/,
      /\bque coisa\b/,
      /\bque chato\b/,
      /\bfrustrant\b/,
    ],
  },

  // ── 7. Atacado / Revenda ─────────────────────────────────────
  {
    intent: 'wholesale',
    priority: 7,
    primary: [
      /\batacado\b/,
      /\brevenda\b/,
      /\bpara revender\b/,
      /\bquero revender\b/,
      /\bvou revender\b/,
      /\bcomprar (em )?lote\b/,
      /\bem quantidade\b/,
      /\bcomprar (varias|varios|bastante)\b/,
    ],
    secondary: [
      /\brevender\b/,
      /\bpara revenda\b/,
      /\bem lote\b/,
      /\bgrande quantidade\b/,
    ],
  },

  // ── 8. Presente / Gifting ────────────────────────────────────
  {
    intent: 'gift',
    priority: 8,
    primary: [
      /\bdar de presente\b/,
      /\bpresentear\b/,
      /\bpresente para\b/,
      /\be para (dar de )?presente\b/,
      /\be pra presente\b/,
      /\bpresente de\b/,
      /\bquero dar\b/,
      /\bvou dar\b/,
    ],
    secondary: [
      /\bpresente\b/,
      /\bembrulh(ar|o)\b/,
      /\bbrinde\b/,
    ],
  },

  // ── 9. Novidades / Lançamentos ───────────────────────────────
  {
    intent: 'new_arrivals',
    priority: 9,
    primary: [
      /\bnovidades?\b/,
      /\blancamentos?\b/,
      /\bcole[cç]ao nova\b/,
      /\bnova cole[cç]ao\b/,
      /\btem coisa nova\b/,
      /\btem produto novo\b/,
    ],
    secondary: [
      /\bchegou\b/,
      /\bchegaram\b/,
      /\bnovo[s]?\b/,
      /\brecente\b/,
    ],
  },

  // ── 10. Ajuda com tamanho / Tabela de medidas ────────────────
  {
    intent: 'size_help',
    priority: 10,
    primary: [
      /\btabela de medidas\b/,
      /\bcomo sei meu tamanho\b/,
      /\bcomo saber meu tamanho\b/,
      /\bnao sei meu tamanho\b/,
      /\bnao sei (qual|o) tamanho\b/,
      /\bmedidas do produto\b/,
    ],
    secondary: [
      /\btabela\b/,
      /\bmedidas\b/,
    ],
  },

  // ── 11. Catálogo / Link ──────────────────────────────────────
  {
    intent: 'catalog',
    priority: 11,
    primary: [
      /\bcatalogo\b/,
      /\bmanda (o )?catalogo\b/,
      /\bver (o )?catalogo\b/,
      /\bonde vejo (as pe[cç][ae]s|os produtos)\b/,
      /\bquero ver (as pe[cç][ae]s|os produtos|tudo)\b/,
      /\blink (do catalogo|dos produtos|do site)\b/,
    ],
    secondary: [
      /\binstagram\b/,
      /\bsite (da loja|de voces)\b/,
      /\bver (as )?fotos\b/,
    ],
  },

  // ── 12. Preço / Promoção (geral) ─────────────────────────────
  {
    intent: 'price',
    priority: 12,
    primary: [
      /\bquanto custa\b/,
      /\bqual (o |o )?preco\b/,
      /\bqual (o )?valor\b/,
      /\bta quanto\b/,
      /\bquanto ta\b/,
      /\bquanto e\b/,
      /\btem promoc[aã]o\b/,
      /\btem oferta\b/,
      /\bquanto fica\b/,
    ],
    secondary: [
      /\bpreco\b/,
      /\bprecinho\b/,
      /\bvalor\b/,
      /\bpromoc[aã]o\b/,
      /\boferta\b/,
      /\bdesconto\b/,
    ],
  },

  // ── 13. Sensibilidade de preço ("tá caro") ───────────────────
  {
    intent: 'price_sensitivity',
    priority: 13,
    primary: [
      /\bta caro\b/,
      /\bmuito caro\b/,
      /\bcaro demais\b/,
      /\balto demais\b/,
      /\bsalgado\b/,
      /\bta pesado\b/,
      /\bque caro\b/,
      /\bnao tenho (esse )?dinheiro\b/,
      /\bficou caro\b/,
    ],
    secondary: [
      /\bcaro\b/,
      /\bpesado\b/,
    ],
  },

  // ── 14. Saudação ─────────────────────────────────────────────
  // Primary: saudação PURA (mensagem é só a saudação).
  // Secondary: saudação dentro de mensagem composta — perde para outros intents.
  {
    intent: 'greeting',
    priority: 14,
    primary: [
      /^(oi|ola|hey|ei|opa|salve|e ai|eai|fala)[\s!.?]*$/,
      /^(bom dia|boa tarde|boa noite)[\s!.?]*$/,
      /^(tudo bem|tudo bom|como vai|oi tudo)[\s!.?]*$/,
    ],
    secondary: [
      /^(oi|ola|hey|ei|opa|fala)\b/,
      /\bbom dia\b/,
      /\bboa tarde\b/,
      /\bboa noite\b/,
      /\btudo bem\b/,
      /\btudo bom\b/,
      /\bcomo vai\b/,
      /\boi tudo\b/,
    ],
  },

  // ── 15. Agradecimento ────────────────────────────────────────
  {
    intent: 'thanks',
    priority: 15,
    primary: [
      /\bobrigad[oa]\b/,
      /\bmuito obrigad[oa]\b/,
      /\bvaleu\b/,
      /\btmj\b/,
      /\bvlw\b/,
      /\bgrat[oa]\b/,
    ],
    secondary: [],
  },

  // ── 16. Despedida ────────────────────────────────────────────
  {
    intent: 'farewell',
    priority: 16,
    primary: [
      /\btchau\b/,
      /\bxau\b/,
      /\bate logo\b/,
      /\bate mais\b/,
      /\bflw\b/,
      /\bbye\b/,
      /\badeus\b/,
    ],
    secondary: [],
  },
];

function scoreIntent(normText: string, def: IntentDef): number {
  const primaryHits   = def.primary.filter(p => p.test(normText)).length;
  const secondaryHits = def.secondary.filter(p => p.test(normText)).length;

  if (primaryHits >= 2)                            return 0.95;
  if (primaryHits === 1 && secondaryHits >= 1)     return 0.92;
  if (primaryHits === 1)                           return 0.90;
  if (secondaryHits >= 2)                          return 0.75;
  if (secondaryHits === 1)                         return 0.62;
  return 0;
}

// Regex de extração de entidades (roda sobre o texto original, não normalizado)
const SIZE_RE    = /\b(PP|P|M|G|GG|XL|XXL|3[5-9]|4[0-6])\b/i;
const COLOR_RE   = /\b(pret[ao]|branc[ao]|azul|vermelh[ao]|verde|amarelh?[ao]|cinza|bege|vinho|navy|laranja|ros[ao]|roxo|caramelo|marrom|creme|nude)\b/i;
const PRODUCT_RE = /\b(camis[ae]t?a?|polo|malha|bermuda|t[êe]nis|bon[eé]|kit)\b/i;
const CITY_RE    = /\b(uberaba|sao paulo|belo horizonte|brasilia|campinas|ribeirao preto)\b/i;

function extractEntities(message: string): IntentEntities | undefined {
  const entities: IntentEntities = {};
  const n = norm(message);

  const sizeM = message.match(SIZE_RE);
  if (sizeM) entities.size = sizeM[0].toUpperCase();

  const colorM = message.match(COLOR_RE);
  if (colorM) entities.color = colorM[0].toLowerCase();

  const prodM = n.match(PRODUCT_RE);
  if (prodM) entities.product = prodM[0];

  const cityM = n.match(CITY_RE);
  if (cityM) entities.location = cityM[0];

  return Object.keys(entities).length > 0 ? entities : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

export function detectIntent(message: string): IntentResult {
  const normText = norm(message);

  let bestIntent: Intent = 'unknown';
  let bestScore = 0;
  let bestPriority = Infinity;

  for (const def of INTENT_DEFS) {
    const score = scoreIntent(normText, def);
    if (score > bestScore || (score === bestScore && def.priority < bestPriority)) {
      bestScore    = score;
      bestIntent   = def.intent;
      bestPriority = def.priority;
    }
  }

  const MIN_CONFIDENCE = 0.60;
  if (bestScore < MIN_CONFIDENCE) {
    return { intent: 'unknown', confidence: 0 };
  }

  return {
    intent:     bestIntent,
    confidence: Math.min(bestScore, 1.0),
    entities:   extractEntities(message),
  };
}
