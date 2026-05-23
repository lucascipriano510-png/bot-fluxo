export interface BotSession {
  id?: string;
  phone: string;
  nome?: string;
  current_node: string;
  context: Record<string, string>;
  criado_em?: string;
  atualizado_em?: string;
}

export interface BotMensagem {
  id?: string;
  phone: string;
  direcao: 'entrada' | 'saida';
  conteudo: string;
  node?: string;
  criado_em?: string;
}

export interface BotLead {
  id?: string;
  phone: string;
  nome?: string;
  interesse?: string;
  origem?: string;
  produto?: string;
  tamanho?: string;
  estilo?: string;
  cidade?: string;
  intencao_compra?: string;
  status_comercial?: 'QUENTE' | 'MORNO' | 'FRIO';
  proxima_acao?: string;
  valor_potencial?: number;
  status: 'novo' | 'qualificado' | 'encaminhado' | 'concluido';
  context?: Record<string, string>;
  qualificado_em?: string;
  atualizado_em?: string;
}

export interface BotResponse {
  text: string;
  nextNode: string;
  context?: Record<string, string>;
}

export interface IncomingMessage {
  phone: string;
  text: string;
  timestamp?: number;
}
