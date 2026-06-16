/**
 * leadSignalsService — o "cérebro" do cerco.
 *
 * Junta os sinais que o site emitiu (read-only) sobre um lead, monta um DOSSIÊ
 * com tudo que sabemos (contato, objeto de desejo, interesses, linha do tempo),
 * classifica a SITUAÇÃO e gera a MENSAGEM PRONTA sob medida — citando o detalhe
 * (ex.: "Camisa Lacoste Azul GG"). Nada é enviado: o dono revisa e manda manual.
 *
 * Desacoplado: lê o site só via siteLeadSignalsBridge (anon, read-only).
 */

import { fetchSignalsByPhone, SiteLeadSignalRow } from '../inventory/siteLeadSignalsBridge';

const WEIGHT: Record<string, number> = {
  whatsapp_produto: 6,
  carrinho_add: 5,
  checkout_aberto: 3,
  telefone_informado: 2,
  produto_visto: 1,
};

export type Situacao =
  | 'carrinho_abandonado'
  | 'curioso_whatsapp'
  | 'carrinho_montado'
  | 'navegando'
  | 'sem_sinais';

export interface InteresseItem {
  sku: string | null;
  label: string;
  name: string | null;
  color: string | null;
  size: string | null;
  brand: string | null;
  category: string | null;
  price: number | null;
  peso: number;
  ultimoEm: string | null;
}

export interface LeadDossie {
  temSinais: boolean;
  totalSinais: number;
  primeiroEm: string | null;
  ultimoEm: string | null;
  situacao: Situacao;
  situacaoLabel: string;
  calor: 'QUENTE' | 'MORNO' | 'FRIO';
  objetoDesejo: InteresseItem | null;
  interesses: InteresseItem[];
  timeline: Array<{ event: string; label: string; detail: string; at: string | null; icon: string }>;
  mensagemPronta: string;
}

// Monta "Camisa Lacoste Azul GG" a partir do detalhe disponível.
function buildLabel(r: { product_name?: string | null; color?: string | null; size?: string | null; brand?: string | null }): string {
  const name = (r.product_name || '').trim();
  const parts: string[] = [];
  if (name) parts.push(name);
  const lowerName = name.toLowerCase();
  if (r.brand && !lowerName.includes(String(r.brand).toLowerCase())) parts.push(String(r.brand));
  if (r.color && !lowerName.includes(String(r.color).toLowerCase())) parts.push(cap(String(r.color)));
  if (r.size) parts.push(String(r.size).toUpperCase());
  return parts.join(' ').trim() || 'um produto da loja';
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const firstName = (n?: string | null) => String(n || '').trim().split(/\s+/)[0] || '';

const EVENT_META: Record<string, { label: string; icon: string }> = {
  produto_visto:      { label: 'Olhou a peça', icon: '👀' },
  whatsapp_produto:   { label: 'Chamou no WhatsApp pela peça', icon: '🟢' },
  carrinho_add:       { label: 'Colocou no carrinho', icon: '🛒' },
  checkout_aberto:    { label: 'Abriu o checkout', icon: '🧾' },
  telefone_informado: { label: 'Informou o WhatsApp', icon: '📱' },
};

const SIT_LABEL: Record<Situacao, string> = {
  carrinho_abandonado: 'Carrinho abandonado',
  curioso_whatsapp:    'Curtiu e foi pro WhatsApp',
  carrinho_montado:    'Montou carrinho',
  navegando:           'Navegando',
  sem_sinais:          'Sem sinais do site',
};

function agrupaInteresses(signals: SiteLeadSignalRow[]): InteresseItem[] {
  const map = new Map<string, InteresseItem>();
  for (const s of signals) {
    if (!s.product_name && !s.product_sku) continue;
    const key = s.product_sku || s.product_name || '';
    if (!key) continue;
    const peso = WEIGHT[s.event || ''] || 1;
    const ex = map.get(key);
    if (ex) {
      ex.peso += peso;
      if (!ex.ultimoEm || (s.created_at && s.created_at > ex.ultimoEm)) ex.ultimoEm = s.created_at;
      ex.color = ex.color || s.color;
      ex.size = ex.size || s.size;
      ex.brand = ex.brand || s.brand;
    } else {
      map.set(key, {
        sku: s.product_sku, name: s.product_name, color: s.color, size: s.size,
        brand: s.brand, category: s.category, price: s.price, peso,
        ultimoEm: s.created_at,
        label: buildLabel(s),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.peso - a.peso || String(b.ultimoEm).localeCompare(String(a.ultimoEm)));
}

function derivaSituacao(signals: SiteLeadSignalRow[]): Situacao {
  const ev = new Set(signals.map(s => s.event || ''));
  if (ev.has('checkout_aberto') || ev.has('telefone_informado')) return 'carrinho_abandonado';
  if (ev.has('whatsapp_produto')) return 'curioso_whatsapp';
  if (ev.has('carrinho_add')) return 'carrinho_montado';
  if (ev.has('produto_visto')) return 'navegando';
  return 'sem_sinais';
}

function calorDe(situacao: Situacao): 'QUENTE' | 'MORNO' | 'FRIO' {
  if (situacao === 'carrinho_abandonado' || situacao === 'curioso_whatsapp') return 'QUENTE';
  if (situacao === 'carrinho_montado') return 'MORNO';
  if (situacao === 'navegando') return 'FRIO';
  return 'FRIO';
}

function geraMensagem(situacao: Situacao, objeto: InteresseItem | null, opts: { nome?: string; loja?: string }): string {
  const oi = opts.nome ? `Oi ${opts.nome}!` : 'Oi!';
  const loja = opts.loja || 'a loja';
  const obj = objeto?.label || 'a peça que você viu';
  switch (situacao) {
    case 'carrinho_abandonado':
      return `${oi} Vi que você separou ${obj} aqui na ${loja} mas não chegou a finalizar 😊 Tá reservado pra você — quer que eu já feche seu pedido e te passo o Pix?`;
    case 'curioso_whatsapp':
      return `${oi} Você demonstrou interesse em ${obj} 👀 Posso te mandar mais fotos e detalhes? Tá disponível e sai com condição especial no Pix. Quer garantir?`;
    case 'carrinho_montado':
      return `${oi} Vi que você montou um carrinho com ${obj}. Quer que eu confira o tamanho/cor e já deixe separado pra você? 🙌`;
    case 'navegando':
      return `${oi} Reparei que você curtiu ${obj} lá no site. Posso te ajudar a escolher o tamanho ou a cor? Qualquer dúvida tô aqui 😉`;
    default:
      return `${oi} Tudo bem? Vi seu interesse na ${loja}. Posso te ajudar a encontrar a peça ideal?`;
  }
}

export async function buildLeadDossie(
  lead: { nome?: string | null; phone?: string | null; phone_real?: string | null },
  opts: { loja?: string } = {},
): Promise<LeadDossie> {
  const signals = await fetchSignalsByPhone(lead.phone_real, lead.phone);
  if (signals.length === 0) {
    return {
      temSinais: false, totalSinais: 0, primeiroEm: null, ultimoEm: null,
      situacao: 'sem_sinais', situacaoLabel: SIT_LABEL.sem_sinais, calor: 'FRIO',
      objetoDesejo: null, interesses: [], timeline: [],
      mensagemPronta: geraMensagem('sem_sinais', null, { nome: firstName(lead.nome), loja: opts.loja }),
    };
  }
  const interesses = agrupaInteresses(signals);
  const objetoDesejo = interesses[0] || null;
  const situacao = derivaSituacao(signals);
  const ordered = [...signals].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const timeline = signals.map(s => {
    const meta = EVENT_META[s.event || ''] || { label: s.event || 'Sinal', icon: '•' };
    const det = buildLabel(s);
    return { event: s.event || '', label: meta.label, detail: det === 'um produto da loja' ? '' : det, at: s.created_at, icon: meta.icon };
  });
  return {
    temSinais: true,
    totalSinais: signals.length,
    primeiroEm: ordered[0]?.created_at || null,
    ultimoEm: ordered[ordered.length - 1]?.created_at || null,
    situacao,
    situacaoLabel: SIT_LABEL[situacao],
    calor: calorDe(situacao),
    objetoDesejo,
    interesses: interesses.slice(0, 8),
    timeline,
    mensagemPronta: geraMensagem(situacao, objetoDesejo, { nome: firstName(lead.nome), loja: opts.loja }),
  };
}
