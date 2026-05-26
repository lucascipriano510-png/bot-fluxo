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
import { STORE } from '../data/botKnowledge';

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
  CAPTURA_ESTILO:     '\n\nE qual estilo você prefere? Básica, polo ou malha premium?',
  CAPTURA_CIDADE:     '\n\nVocê está em *Uberaba* ou é envio pra outra cidade?',
  RECOMENDACAO:       '\n\nVoltando às opções: quer a *mais em conta* ou a *mais premium?*',
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
      `Não entendi muito bem 😅 Me fala o que você procura: camisa, polo, tênis, bermuda ou boné?`,
      `Hmm, pode repetir? 😊 Estou aqui pra ajudar com *${storeName}* — é sobre algum produto?`,
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
        `Fazemos sim. Entregamos em Uberaba e enviamos pra todo o Brasil pelos Correios. Me fala seu bairro ou cidade que eu te ajudo com a melhor opção.`,
        `Entregamos sim! Uberaba tem entrega local rápida, e pra todo o Brasil mandamos pelos Correios — prazo de ${STORE.delivery.nationwideDays}. Qual é sua cidade?`,
        `Sim, entregamos. Tanto pra Uberaba quanto pra qualquer cidade do Brasil. Me fala onde você está que eu calculo a melhor forma.`,
      ], message) + p;
      break;

    // ── HORÁRIO ──────────────────────────────────────────────────────────────
    case 'hours':
      reply = pick([
        `A Fluxo funciona de ${STORE.hours.full}. Quer que eu te ajude a escolher uma peça antes de vir?`,
        `Funcionamos ${STORE.hours.full}. Domingo fechado. Posso te ajudar a separar algo antes de você aparecer.`,
        `Nosso horário: ${STORE.hours.full}. Me fala o que você procura que eu já preparo antes de você vir.`,
      ], message) + p;
      break;

    // ── LOCALIZAÇÃO ──────────────────────────────────────────────────────────
    case 'location':
      reply = pick([
        `Temos loja física aqui em Uberaba, MG. O endereço completo te mando pelo WhatsApp. Você também pode retirar pessoalmente. Me fala o que você procura que eu separo antes de você chegar.`,
        `Temos ponto físico em Uberaba. Pode vir buscar na loja ou pedir entrega. Me fala o que você quer que eu já separo.`,
        `Loja física em Uberaba, MG — pode vir retirar. Para o endereço exato, te mando direto no WhatsApp. O que você está procurando?`,
      ], message) + p;
      break;

    // ── TROCA / DEVOLUÇÃO ────────────────────────────────────────────────────
    case 'exchange':
      reply = pick([
        `Pode trocar sim, ${STORE.exchange.conditions}. Mas acertar o tamanho agora evita esse trabalho. Me fala o produto e seu tamanho que eu já te direciono certo.`,
        `Temos troca em até ${STORE.exchange.deadlineDays} dias, sem uso e com etiqueta. Me conta o que você procura e me fala sua medida que eu ajudo a acertar de primeira.`,
        `Pode trocar — ${STORE.exchange.deadlineDays} dias após o recebimento, sem uso. Melhor é escolher certo agora. Me fala o tamanho que você usa que eu te ajudo.`,
      ], message) + p;
      break;

    // ── PAGAMENTO ────────────────────────────────────────────────────────────
    case 'payment':
      reply = pick([
        `Aceitamos ${STORE.payment.short}. Tudo certo pra fechar! O que você quer levar?`,
        `Pode pagar por Pix, cartão crédito em até 6x, débito ou boleto. Me fala o que você quer que eu te direciono.`,
        `${STORE.payment.methods[0]}, cartão em até 6x, débito e boleto — tem de tudo. O que você está procurando?`,
      ], message) + p;
      break;

    // ── CATÁLOGO / LINK ──────────────────────────────────────────────────────
    case 'catalog':
      reply = pick([
        `Você pode ver as peças em *${STORE.catalog.website}* ou no nosso Instagram *${STORE.catalog.instagram}*. Me fala o que você procura que eu te ajudo direto aqui: camisa, polo, tênis, bermuda ou boné.`,
        `O catálogo completo está em *${STORE.catalog.website}*. Me fala o que você curte que eu já te mostro as opções aqui mesmo.`,
        `Pode ver pelo site *${STORE.catalog.website}* ou pelo Insta *${STORE.catalog.instagram}*. Me fala a categoria e eu te direciono melhor.`,
      ], message) + p;
      break;

    // ── PREÇO / PROMOÇÃO ─────────────────────────────────────────────────────
    case 'price': {
      const prod = entities?.product;
      reply = pick([
        `Temos peças em vários preços${prod ? ` de ${prod}` : ''} — me fala o produto e tamanho que eu te dou os valores disponíveis.`,
        `Os preços variam por modelo e tamanho${prod ? ` (${prod})` : ''}. Me fala o que você quer ver que eu te mostro as opções.`,
        `Tem promoção e tem linha premium. Me fala o produto${prod ? '' : ' (camisa, polo, tênis, bermuda ou boné)'} e tamanho que eu te mostro os melhores preços.`,
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
        `Boa ideia! A Fluxo tem ótimas pedidas pra presente. Me fala: é pra homem? Qual tamanho usa? Com isso já te indico o que vai agradar.`,
        `Presente na Fluxo é certeiro. Me conta sobre a pessoa — tamanho e estilo — que eu te ajudo a escolher certo.`,
        `Boa escolha! Me conta: qual tamanho a pessoa usa e o que costuma vestir. Aí te indico as melhores opções.`,
      ], message) + p;
      break;

    // ── NOVIDADES ────────────────────────────────────────────────────────────
    case 'new_arrivals':
      reply = pick([
        `Estamos sempre renovando o estoque! Me fala o que você curte — camisa, polo, tênis ou bermuda — que eu te mostro o que tem de mais recente.`,
        `Novidade chega toda semana. Me fala a categoria que você quer e eu te conto o que entrou mais novo.`,
        `Tem novidade sim! Me fala o que você procura que eu te direciono pro que chegou mais recente.`,
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
