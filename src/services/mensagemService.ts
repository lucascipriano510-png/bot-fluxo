import { supabase } from '../lib/supabase';
import { BotMensagem } from '../types';

// ── Cache em memória — TTL 60 segundos ──────────────────────────────────────
const HIST_CACHE_TTL_MS = 60 * 1_000;
const _histCache = new Map<string, { data: BotMensagem[]; expiresAt: number }>();

function histCacheGet(key: string): BotMensagem[] | null {
  const entry = _histCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) _histCache.delete(key);
    return null;
  }
  return entry.data;
}

function histCacheSet(key: string, data: BotMensagem[]): void {
  _histCache.set(key, { data, expiresAt: Date.now() + HIST_CACHE_TTL_MS });
}

export async function saveMensagem(msg: Omit<BotMensagem, 'id' | 'criado_em'>): Promise<void> {
  const { error } = await supabase.from('bot_mensagens').insert([msg]);
  if (error) console.warn('[mensagemService] erro ao salvar mensagem:', error.message);
  _histCache.delete(`hist:${msg.store_id}:${msg.phone}`);
}

export async function fetchHistorico(
  storeId: string,
  phone: string,
  limit = 20,
): Promise<BotMensagem[]> {
  const key = `hist:${storeId}:${phone}`;
  const cached = histCacheGet(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('bot_mensagens')
    .select('*')
    .eq('store_id', storeId)
    .eq('phone', phone)
    .order('criado_em', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const result = (data || []).reverse() as BotMensagem[];
  histCacheSet(key, result);
  return result;
}
