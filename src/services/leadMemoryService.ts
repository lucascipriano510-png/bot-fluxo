/**
 * leadMemoryService — memória de longo prazo por cliente.
 *
 * A sessão do bot expira em 60min e o histórico injetado na IA é curto (8 msgs).
 * Este serviço fecha o buraco: a cada N trocas com a IA, resume a conversa com
 * o modelo barato (fallback) e grava em bot_leads.context.memoria. O resumo
 * volta pro prompt via buildLeadProfile — o bot "lembra" do cliente semanas
 * depois, entre sessões e entre reinícios do servidor.
 *
 * Roda em fire-and-forget: nunca atrasa nem derruba a resposta ao cliente.
 */

import { supabase } from '../lib/supabase';
import { fetchHistorico } from './mensagemService';
import { simpleCompletion } from './aiAssistService';

const EVERY_N_REPLIES = 5;
const _counters = new Map<string, number>(); // `${storeId}:${phone}` → nº de respostas de IA

export function maybeUpdateLeadMemory(storeId: string, phone: string): void {
  const key = `${storeId}:${phone}`;
  const n = (_counters.get(key) || 0) + 1;
  _counters.set(key, n);
  if (n % EVERY_N_REPLIES !== 0) return;

  updateLeadMemory(storeId, phone).catch(err =>
    console.warn('[leadMemory] falhou (não crítico):', (err as Error).message));
}

async function updateLeadMemory(storeId: string, phone: string): Promise<void> {
  if (!process.env.AI_ASSIST_KEY) return;

  const historico = await fetchHistorico(storeId, phone, 24);
  if (historico.length < 4) return;

  const transcript = historico
    .map(m => `${m.direcao === 'entrada' ? 'CLIENTE' : 'LOJA'}: ${m.conteudo.slice(0, 200)}`)
    .join('\n');

  const { data: lead } = await supabase
    .from('bot_leads')
    .select('id, context')
    .eq('store_id', storeId)
    .eq('phone', phone)
    .maybeSingle();
  if (!lead) return;

  const memoriaAnterior = (lead.context as Record<string, unknown> | null)?.memoria;
  const prompt = [
    'Você mantém a memória de um vendedor sobre um cliente de WhatsApp.',
    memoriaAnterior ? `MEMÓRIA ATUAL:\n${memoriaAnterior}` : '',
    `CONVERSA RECENTE:\n${transcript}`,
    '',
    'Atualize a memória em até 3 frases curtas com o que importa pra vender pra esse cliente:',
    'preferências (categoria, cor, tamanho, faixa de preço), o que ele buscou, objeções e pendências.',
    'Responda SOMENTE com a memória atualizada, sem comentários.',
  ].filter(Boolean).join('\n');

  // Roteia pelo provider configurado (Gemini barato ou Claude Haiku)
  const memoria = await simpleCompletion(prompt, 200);
  if (!memoria) return;

  const context = { ...(lead.context as Record<string, unknown> || {}), memoria, memoria_atualizada: new Date().toISOString() };
  await supabase.from('bot_leads').update({ context }).eq('id', lead.id);
  console.log('[leadMemory] memória atualizada para', phone, '—', memoria.slice(0, 80));
}
