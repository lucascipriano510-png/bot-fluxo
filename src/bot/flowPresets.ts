/**
 * Flow Presets — configurações iniciais de fluxo por tipo de negócio.
 *
 * Cada preset é um array de overrides que são inseridos em bot_flow_config
 * no momento do cadastro da loja. A engine já usa bot_flow_config como
 * camada acima do flowMap base, portanto nenhuma outra mudança é necessária.
 *
 * Tipos disponíveis:
 *   varejo       — loja de roupas, calçados, acessórios (ex: Fluxo Outlet)
 *   servicos     — serviços por demanda (ex: lava-jato, assistência técnica)
 *   agendamento  — serviços com hora marcada (ex: barbearia, salão, clínica)
 *   generico     — funil simples sem captura de atributos
 */

export type BusinessType = 'varejo' | 'servicos' | 'agendamento' | 'generico';

export interface PresetNode {
  node_id:      string;
  message:      string | null;
  options:      Array<{ trigger: string; next: string; data?: Record<string, string> }> | null;
  default_next: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────

const PRESETS: Record<BusinessType, PresetNode[]> = {

  // ── VAREJO — loja de roupas, calçados, acessórios ───────────────────────
  varejo: [
    {
      node_id: 'INICIO',
      message: null, // usa a mensagem dinâmica do flowMap base (já usa _saudacao)
      options: [
        { trigger: 'camis[ae]t?a?|polo|malha|camisinha', next: 'CAPTURA_TAMANHO', data: { origem: 'camisa', interesse: 'camisa' } },
        { trigger: 't[êe]nis|cal[çc]ado|sapato|sneaker', next: 'CAPTURA_NUMERO',  data: { origem: 'tenis',   interesse: 'tenis'   } },
        { trigger: 'bermuda|short',                       next: 'CAPTURA_TAMANHO', data: { origem: 'bermuda', interesse: 'bermuda' } },
        { trigger: 'promo[çc][ãa]o?|oferta|desconto',    next: 'CAPTURA_TAMANHO', data: { origem: 'promocao'                      } },
        { trigger: 'pedido|status|rastrear',              next: 'CONSULTA_PEDIDO'                                                   },
        { trigger: 'atendente|humano|suporte|falar com',  next: 'SUPORTE'                                                           },
      ],
      default_next: 'APRESENTACAO',
    },
    {
      node_id: 'APRESENTACAO',
      message: 'Me fala o que você procura hoje:\n\n👕  Camisa, polo ou malha\n👟  Tênis ou calçado\n👖  Bermuda\n\nDigita aí 👇',
      options: [
        { trigger: 'camis[ae]t?a?|polo|malha', next: 'CAPTURA_TAMANHO', data: { origem: 'camisa',  interesse: 'camisa'  } },
        { trigger: 't[êe]nis|cal[çc]ado',      next: 'CAPTURA_NUMERO',  data: { origem: 'tenis',   interesse: 'tenis'   } },
        { trigger: 'bermuda|short',             next: 'CAPTURA_TAMANHO', data: { origem: 'bermuda', interesse: 'bermuda' } },
      ],
      default_next: 'NAO_ENTENDI',
    },
    {
      node_id: 'CAPTURA_TAMANHO',
      message: 'Qual tamanho você usa?\n*P  ·  M  ·  G  ·  GG*',
      options: null,
      default_next: 'CAPTURA_ESTILO',
    },
    {
      node_id: 'CAPTURA_ESTILO',
      message: 'Qual estilo você prefere?\n*Básica  ·  Polo  ·  Premium*',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_NUMERO',
      message: 'Qual numeração você usa? _(ex: 39, 40, 41, 42...)_',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_CIDADE',
      message: 'Você busca localmente ou prefere receber por entrega?',
      options: null,
      default_next: 'RECOMENDACAO',
    },
    {
      node_id: 'NAO_ENTENDI',
      message: 'Hmm, não entendi 😅\n\nMe fala o que você procura:\n\n👕  Camisa, polo ou malha\n👟  Tênis\n👖  Bermuda',
      options: null,
      default_next: 'INICIO',
    },
  ],

  // ── SERVIÇOS — lava-jato, assistência técnica, gráfica etc. ─────────────
  servicos: [
    {
      node_id: 'INICIO',
      message: null,
      options: [
        { trigger: 'pre[çc]o|quanto|valor|custa|or[çc]amento', next: 'CAPTURA_TAMANHO', data: { origem: 'preco'   } },
        { trigger: 'agendar|marcar|reservar|agendar',           next: 'CAPTURA_NUMERO',  data: { origem: 'agenda'  } },
        { trigger: 'pedido|status|meu servi[çc]o|andamento',    next: 'CONSULTA_PEDIDO'                              },
        { trigger: 'atendente|humano|falar com|suporte',        next: 'SUPORTE'                                      },
      ],
      default_next: 'APRESENTACAO',
    },
    {
      node_id: 'APRESENTACAO',
      message: 'Me fala como posso te ajudar:\n\n💰  Preço / Orçamento\n📅  Agendar serviço\n📦  Status do meu pedido\n\nDigita aí 👇',
      options: [
        { trigger: 'pre[çc]o|quanto|valor|or[çc]amento', next: 'CAPTURA_TAMANHO', data: { origem: 'preco'  } },
        { trigger: 'agendar|marcar|reservar',             next: 'CAPTURA_NUMERO',  data: { origem: 'agenda' } },
        { trigger: 'pedido|status|andamento',             next: 'CONSULTA_PEDIDO'                              },
      ],
      default_next: 'NAO_ENTENDI',
    },
    {
      node_id: 'CAPTURA_TAMANHO',
      message: 'Qual serviço você precisa? Pode me descrever.',
      options: null,
      default_next: 'CAPTURA_ESTILO',
    },
    {
      node_id: 'CAPTURA_ESTILO',
      message: 'Perfeito. Tem algum detalhe adicional que devo saber? _(ex: urgência, especificações)_',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_NUMERO',
      message: 'Qual a melhor data e horário para você? _(ex: segunda às 14h)_',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_CIDADE',
      message: 'Qual o seu nome para eu já deixar registrado?',
      options: null,
      default_next: 'RECOMENDACAO',
    },
    {
      node_id: 'RECOMENDACAO',
      message: 'Perfeito! Tenho as informações que preciso.\n\nVou te passar o orçamento e disponibilidade. Qual o melhor jeito de te retornar?\n\n📱  WhatsApp\n📞  Ligação',
      options: [
        { trigger: 'whatsapp|zap|mensagem|aqui',    next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano' } },
        { trigger: 'liga[çc][ãa]o|ligar|telefone',  next: 'CAPTURA_NOME_QUENTE', data: { status_comercial: 'QUENTE', proxima_acao: 'chamar_humano' } },
      ],
      default_next: 'CAPTURA_NOME_QUENTE',
    },
    {
      node_id: 'NAO_ENTENDI',
      message: 'Não entendi muito bem 😅 Me fala o que você precisa:\n\n💰  Orçamento\n📅  Agendar\n📦  Status do pedido',
      options: null,
      default_next: 'INICIO',
    },
  ],

  // ── AGENDAMENTO — barbearia, salão, clínica, personal ────────────────────
  agendamento: [
    {
      node_id: 'INICIO',
      message: null,
      options: [
        { trigger: 'agendar|marcar|quero|reservar|horario|vaga', next: 'CAPTURA_TAMANHO', data: { origem: 'agenda'   } },
        { trigger: 'pre[çc]o|quanto|valor|tabela',               next: 'CAPTURA_NUMERO',  data: { origem: 'preco'    } },
        { trigger: 'meu agendamento|cancelar|remarcar|trocar',   next: 'CONSULTA_PEDIDO'                               },
        { trigger: 'atendente|falar com|humano|suporte',         next: 'SUPORTE'                                       },
      ],
      default_next: 'APRESENTACAO',
    },
    {
      node_id: 'APRESENTACAO',
      message: 'Como posso te ajudar?\n\n📅  Agendar horário\n💰  Ver preços e serviços\n🔄  Meu agendamento\n\nDigita aí 👇',
      options: [
        { trigger: 'agendar|marcar|horario|vaga|quero',  next: 'CAPTURA_TAMANHO', data: { origem: 'agenda' } },
        { trigger: 'pre[çc]o|quanto|valor|tabela',       next: 'CAPTURA_NUMERO',  data: { origem: 'preco'  } },
        { trigger: 'agendamento|cancelar|remarcar',      next: 'CONSULTA_PEDIDO'                              },
      ],
      default_next: 'NAO_ENTENDI',
    },
    {
      node_id: 'CAPTURA_TAMANHO',
      message: 'Qual serviço você quer agendar?',
      options: null,
      default_next: 'CAPTURA_ESTILO',
    },
    {
      node_id: 'CAPTURA_ESTILO',
      message: 'Você tem preferência de profissional ou qualquer um está ótimo?',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_NUMERO',
      message: 'Quer ver nossa tabela de preços? Posso te mandar os valores de cada serviço.',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_CIDADE',
      message: 'Qual a melhor data e período para você?\n\n🌅  Manhã (até 12h)\n🌤  Tarde (12h às 18h)\n🌆  Noite (após 18h)',
      options: null,
      default_next: 'RECOMENDACAO',
    },
    {
      node_id: 'RECOMENDACAO',
      message: 'Ótimo! Vou verificar os horários disponíveis e te confirmar.\n\nQual é o seu nome para o agendamento?',
      options: null,
      default_next: 'CAPTURA_NOME_QUENTE',
    },
    {
      node_id: 'NAO_ENTENDI',
      message: 'Não entendi 😅 Você quer:\n\n📅  Agendar horário\n💰  Ver preços\n🔄  Gerenciar agendamento',
      options: null,
      default_next: 'INICIO',
    },
  ],

  // ── GENÉRICO — funil simples para qualquer negócio ───────────────────────
  generico: [
    {
      node_id: 'INICIO',
      message: null,
      options: [
        { trigger: 'pedido|status|acompanhar',          next: 'CONSULTA_PEDIDO' },
        { trigger: 'atendente|humano|falar com|suporte', next: 'SUPORTE'         },
      ],
      default_next: 'APRESENTACAO',
    },
    {
      node_id: 'APRESENTACAO',
      message: 'Como posso te ajudar hoje?\n\nDescreve o que você precisa e eu te direciono. 👇',
      options: [],
      default_next: 'CAPTURA_TAMANHO',
    },
    {
      node_id: 'CAPTURA_TAMANHO',
      message: 'Pode me dar mais detalhes sobre o que você precisa?',
      options: null,
      default_next: 'CAPTURA_CIDADE',
    },
    {
      node_id: 'CAPTURA_CIDADE',
      message: 'Qual o seu nome para eu já deixar registrado?',
      options: null,
      default_next: 'RECOMENDACAO',
    },
    {
      node_id: 'RECOMENDACAO',
      message: 'Obrigado pelas informações! Vou chamar um atendente para te ajudar da melhor forma. 🙋',
      options: null,
      default_next: 'CAPTURA_NOME_QUENTE',
    },
    {
      node_id: 'NAO_ENTENDI',
      message: 'Não entendi muito bem 😅 Pode repetir ou me falar de outra forma?',
      options: null,
      default_next: 'APRESENTACAO',
    },
  ],
};

export function getPreset(type: BusinessType): PresetNode[] {
  return PRESETS[type] ?? PRESETS['generico'];
}
