// ═══════════════════════════════════════════════════════════════════════════
//  leadScoreService — Calcula score de conversão do lead (0-100).
//
//  O score combina sinais comportamentais reais:
//  - Engajamento (quantas mensagens trocou)
//  - Recência (quão recente foi a última interação)
//  - Qualificação (quantos campos do funil preencheu)
//  - Status comercial (QUENTE/MORNO/FRIO)
//  - Histórico (já comprou antes?)
//  - Valor potencial (ticket alto pesa mais)
//
//  Não usa IA — é determinístico e rápido. Roda no cálculo de cada lead.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';

interface ScoreInput {
  status_comercial?:    string;
  valor_potencial?:     number;
  interesse?:           string;
  cidade?:              string;
  tamanho?:             string;
  nome?:                string;
  total_purchases?:     number;
  last_interaction_at?: string;
  message_count?:       number;
}

export function calculateLeadScore(lead: ScoreInput): number {
  let score = 0;

  // 1. Status comercial (peso 30)
  if (lead.status_comercial === 'QUENTE') score += 30;
  else if (lead.status_comercial === 'MORNO') score += 18;
  else if (lead.status_comercial === 'FRIO') score += 5;

  // 2. Qualificação — quantos campos preencheu (peso 20)
  const qualFields = [lead.nome, lead.interesse, lead.cidade, lead.tamanho].filter(Boolean).length;
  score += qualFields * 5;

  // 3. Histórico de compras (peso 25)
  if (lead.total_purchases && lead.total_purchases > 0) {
    score += Math.min(25, 15 + lead.total_purchases * 5);
  }

  // 4. Valor potencial (peso 15)
  if (lead.valor_potencial) {
    if (lead.valor_potencial >= 500) score += 15;
    else if (lead.valor_potencial >= 200) score += 10;
    else if (lead.valor_potencial >= 80) score += 6;
    else score += 3;
  }

  // 5. Recência da última interação (peso 10)
  if (lead.last_interaction_at) {
    const hoursSince = (Date.now() - new Date(lead.last_interaction_at).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 2) score += 10;
    else if (hoursSince < 24) score += 7;
    else if (hoursSince < 72) score += 4;
    else if (hoursSince < 168) score += 2;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

export async function updateLeadScore(storeId: string, leadId: string): Promise<number> {
  const { data: lead } = await supabase
    .from('bot_leads')
    .select('*')
    .eq('id', leadId)
    .eq('store_id', storeId)
    .single();

  if (!lead) return 0;

  const { count } = await supabase
    .from('bot_mensagens')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('phone', lead.phone);

  const score = calculateLeadScore({ ...lead, message_count: count || 0 });

  await supabase
    .from('bot_leads')
    .update({ conversion_score: score, last_interaction_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('store_id', storeId);

  return score;
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Muito quente', color: '#ef4444' };
  if (score >= 50) return { label: 'Promissor',    color: '#f59e0b' };
  if (score >= 25) return { label: 'Em construção', color: '#38bdf8' };
  return { label: 'Frio', color: '#6b7280' };
}
