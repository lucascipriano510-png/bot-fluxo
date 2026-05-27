// ═══════════════════════════════════════════════════════════════════════════
//  chatBrainService — gera respostas naturais baseadas na intenção detectada
//
//  Fluxo:
//  1. Recebe intenção + entidades de intentService
//  2. Escolhe variante de resposta de forma determinística
//  3. Quando o usuário está em nó de captura, anexa a pergunta pendente
//     para manter o funil de qualificação ativo
//
//  Retorna null quando a intenção é desconhecida → engine cai no flowMap
// ═══════════════════════════════════════════════════════════════════════════

import { Intent, IntentResult } from './intentService';

export interface BrainResult {
  reply:           string;
  detectedIntent:  Intent;
  confidence:      number;
}

// Questão pendente para cada nó de captura.
// Quando o brain intercepta uma mensagem dentro de um nó CAPTURA_*,
// responde a intenção do cliente E depois resgata a pergunta do funil.
const PENDING_QUESTION: Record<string, string> = {
  CAPTURA_TAMANHO:    '\n\nE qual tamanho você usa? *P  ·  M  ·  G  ·  GG*',
  CAPTURA_NUMERO:     '\n\nE qual numeração você usa? _(ex: 39, 40, 41, 42)_',
  CAPTURA_ESTILO:     '\n\nTem algum detalhe adicional que devo saber?',
  CAPTURA_CIDADE:     '\n\nVocê prefere retirar na loja ou receber por entrega?',
  RECOMENDACAO:       '\n\nQual é o seu nome para eu registrar?',
  AGUARDAR_RESPOSTA:  '\n\nPra eu finalizar, qual é o seu nome?',
  CAPTURA_NOME_QUENTE:'\n\nPra eu te atender, qual é o seu nome?',
};

// Escolha determinística de variante baseada no conteúdo da mensagem
function pick<T>(arr: T[], seed: string): T {
  const code = (seed.charCodeAt(0) || 0) + (seed.charCodeAt(1) || 0);
  return arr[code % arr.length];
}

function pend(nodeId: string): string {
  return PENDING_QUESTION[nodeId] ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────

export function handleIntent(
  message: string,
  intentResult: IntentResult,
  ctx: Record<string, string>,
  currentNodeId: string,
): BrainResult | null {
  const { intent, confidence, entities } = intentResult;

  // Mensagem não reconhecida no INICIO — responde com menu suave sem escalar para APRESENTACAO
  if (intent === 'unknown' && currentNodeId === 'INICIO') {
    const storeName = ctx._storeName || 'nossa loja';
    const reply = pick([
      `Não entendi muito bem 😅 Me fala o que você precisa que eu te direciono.`,
      `Hmm, pode repetir? 😊 Estou aqui pra ajudar com *${storeName}*. O que você precisa?`,
      `Não captei bem! Me conta o que você está buscando que eu te ajudo. 👇`,
    ], message);
    return { reply, detectedIntent: 'unknown', confidence: 0 };
  }

  if (intent === 'unknown') return null;

  const p = pend(currentNodeId);
  let reply: string;

  switch (intent) {

    // ── ENTREGA ─────────────────────────────────────────────────────────────
    case 'delivery':
      reply = pick([
        `Fazemos entregas sim! Me fala sua cidade que te informo o prazo e a melhor opção de envio.`,
        `Entregamos para todo o Brasil. Qual é sua cidade?`,
        `Tem entrega sim! Me conta onde você está que te passo as opções disponíveis.`,
      ], message) + p;
      break;

    // ── HORÁRIO ──────────────────────────────────────────────────────────────
    case 'hours':
      reply = pick([
        `Para confirmar o horário de atendimento, posso te conectar com um atendente agora. Quer?`,
        `Me deixa chamar um atendente que ele te confirma o horário certinho.`,
        `Nosso horário comercial pode variar. Posso te conectar com alguém que confirma pra você agora.`,
      ], message) + p;
      break;

    // ── LOCALIZAÇÃO ──────────────────────────────────────────────────────────
    case 'location':
      reply = pick([
        `Temos loja física! Para o endereço exato, posso te mandar pelo WhatsApp ou chamar um atendente. O que prefere?`,
        `Tem loja física sim. Me fala que eu passo o endereço ou te conecto com um atendente.`,
        `Pode vir retirar na loja. Para o endereço completo, é só pedir que eu te passo agora.`,
      ], message) + p;
      break;

    // ── TROCA / DEVOLUÇÃO ────────────────────────────────────────────────────
    case 'exchange':
      reply = pick([
        `Pode trocar sim! Para saber as condições exatas, posso te conectar com um atendente agora. Quer?`,
        `Temos política de troca. Me fala o que aconteceu que eu te direciono pro atendente responsável.`,
        `Sem problema! Me conta a situação que eu te ajudo a resolver ou chamo um atendente.`,
      ], message) + p;
      break;

    // ── PAGAMENTO ────────────────────────────────────────────────────────────
    case 'payment':
      reply = pick([
        `Aceitamos as principais formas de pagamento. Para confirmar as opções disponíveis, posso chamar um atendente.`,
        `Tem várias formas de pagamento disponíveis. Me fala o que você precisa que te informo.`,
        `Para detalhes sobre pagamento, posso te conectar com um atendente agora. Quer?`,
      ], message) + p;
      break;

    // ── CATÁLOGO / LINK ──────────────────────────────────────────────────────
    case 'catalog':
      reply = pick([
        `Posso te ajudar a encontrar o que você precisa direto aqui. Me fala o produto e eu te direciono.`,
        `Me fala o que você está procurando que eu te mostro as opções disponíveis.`,
        `Aqui mesmo consigo te ajudar. Qual produto ou categoria você quer ver?`,
      ], message) + p;
      break;

    // ── PREÇO / PROMOÇÃO ─────────────────────────────────────────────────────
    case 'price': {
      const prod = entities?.product;
      reply = pick([
        `Me fala ${prod ? `mais sobre ${prod}` : 'o produto que você quer'} que eu te passo os valores disponíveis.`,
        `Os preços variam por modelo. Me fala o que você quer ver que eu te mostro as opções.`,
        `Me conta o produto${prod ? '' : ' que você precisa'} e eu te dou as informações de preço.`,
      ], message) + p;
      break;
    }

    // ── SENSIBILIDADE DE PREÇO ───────────────────────────────────────────────
    case 'price_sensitivity':
      reply = pick([
        `Entendo! Temos opções que cabem no bolso sim. Me fala o produto que você quer e eu te mostro as pedidas mais em conta.`,
        `Temos peças com ótimo custo-benefício. Me fala o que você procura que eu filtro as melhores opções de preço.`,
        `Tem opção pra todo bolso aqui. Me fala o produto e tamanho que eu te mostro o que encaixa no seu orçamento.`,
      ], message) + p;
      break;

    // ── RECLAMAÇÃO ───────────────────────────────────────────────────────────
    case 'complaint':
      reply = pick([
        `Poxa, entendo a frustração! Me conta o que aconteceu que eu te ajudo. Se preferir, posso chamar um atendente.`,
        `Desculpa o transtorno! O que posso fazer pra te ajudar agora? Me fala o que você precisa.`,
        `Entendo! Pode me contar melhor o que houve? Tô aqui pra resolver.`,
      ], message);
      break;

    // ── ATACADO / REVENDA ────────────────────────────────────────────────────
    case 'wholesale':
      reply = pick([
        `Trabalhamos com atacado sim! Para compras em quantidade, o melhor é falar direto com nosso time. Me fala o produto e a quantidade que você precisa que eu já encaminho.`,
        `Tem atacado sim. Me fala o que você precisa — produto e quantidade — que eu te conecto com o time comercial.`,
        `Para revenda ou lote, nossa equipe resolve. Me conta produto e quantidade que eu te direciono pro atendente certo.`,
      ], message);
      break;

    // ── PRESENTE ─────────────────────────────────────────────────────────────
    case 'gift':
      reply = pick([
        `Boa ideia! Me conta sobre a pessoa — o que ela costuma usar — que eu te ajudo a escolher certo.`,
        `Presente é uma ótima pedida! Me fala o estilo e tamanho da pessoa que eu te indico as melhores opções.`,
        `Boa escolha! Me conta: qual é o estilo e tamanho que a pessoa usa. Com isso já te direciono certinho.`,
      ], message) + p;
      break;

    // ── NOVIDADES ────────────────────────────────────────────────────────────
    case 'new_arrivals':
      reply = pick([
        `Estamos sempre renovando! Me fala o que você procura que eu te mostro o que há de mais recente.`,
        `Novidades chegam com frequência. Me fala a categoria que você quer e eu te mostro o que entrou mais novo.`,
        `Tem novidade sim! Me conta o que você está buscando que eu te direciono.`,
      ], message) + p;
      break;

    // ── AJUDA COM TAMANHO ────────────────────────────────────────────────────
    case 'size_help':
      reply = pick([
        `As peças seguem o padrão do mercado: *P* (até 90cm peito), *M* (até 98cm), *G* (até 106cm), *GG* (até 114cm). Me fala o que você usa em outras marcas que eu confirmo.`,
        `Seguimos a tabela padrão brasileira. Me fala sua medida de peito ou o tamanho que você usa normalmente e eu te ajudo a acertar.`,
        `Em geral: se você usa M em qualquer loja, usa M aqui. Me fala o tamanho que você costuma usar que eu confirmo pra você.`,
      ], message) + p;
      break;

    // ── AGRADECIMENTO ────────────────────────────────────────────────────────
    case 'thanks':
      reply = pick([
        `Disponha! Se precisar de mais alguma coisa é só chamar.`,
        `Boa! Qualquer coisa é só falar.`,
        `Por nada! Estou aqui se precisar.`,
      ], message);
      break;

    // ── DESPEDIDA ────────────────────────────────────────────────────────────
    case 'farewell':
      reply = pick([
        `Até mais! Se precisar de algo é só chamar. Boas compras! 👋`,
        `Falou! Qualquer coisa pode voltar aqui.`,
        `Até! Qualquer dúvida manda mensagem.`,
      ], message);
      break;

    // ── SAUDAÇÃO ─────────────────────────────────────────────────────────────
    case 'greeting':
      if (p) {
        // Usuário está no meio de um fluxo — resgata a pergunta pendente
        reply = pick([
          `Oi! Continuando por aqui.${p}`,
          `Fala! Bora continuar o atendimento.${p}`,
          `Oi! Estava te esperando.${p}`,
        ], message);
      } else {
        // Sem nó pendente — só a saudação configurada, deixa o cliente responder
        reply = ctx._saudacao || `Oi! 👋 Bem-vindo à *${ctx._storeName || 'nossa loja'}*.`;
      }
      break;

    default:
      return null;
  }

  return { reply, detectedIntent: intent, confidence };
}
