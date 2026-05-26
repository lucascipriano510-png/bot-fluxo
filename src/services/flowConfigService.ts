import { supabase } from '../lib/supabase';
import { NodeId } from '../bot/flowMap';

export interface NodeConfigRow {
  node_id: string;
  message?: string | null;
  options?: Array<{ trigger: string; next: string; data?: Record<string, string> }> | null;
  default_next?: string | null;
}

// Cache por store: storeId → { data, timestamp }
const _cache = new Map<string, { data: Map<string, NodeConfigRow>; time: number }>();
const CACHE_TTL = 15_000;

export async function loadFlowConfig(storeId: string): Promise<Map<string, NodeConfigRow>> {
  const entry = _cache.get(storeId);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;

  const { data, error } = await supabase
    .from('bot_flow_config')
    .select('*')
    .eq('store_id', storeId);

  if (error) {
    if (error.code === '42P01') return new Map();
    console.warn('[flowConfig] erro ao carregar:', error.message);
    return entry?.data ?? new Map();
  }

  const map = new Map((data || []).map(r => [r.node_id, r as NodeConfigRow]));
  _cache.set(storeId, { data: map, time: Date.now() });
  return map;
}

export function invalidateFlowCache(storeId?: string): void {
  if (storeId) _cache.delete(storeId);
  else _cache.clear();
}

export function triggerToRegex(triggerStr: string): RegExp {
  const hasRegexChars = /[[\]{}()*+?^$\\]/.test(triggerStr);
  const pattern = hasRegexChars
    ? triggerStr
    : triggerStr.split(',').map(k => k.trim()).filter(Boolean).join('|');
  return new RegExp(pattern, 'i');
}
