import { supabase } from '../lib/supabase';
import { NodeId } from '../bot/flowMap';

export interface NodeConfigRow {
  node_id: string;
  message?: string | null;
  options?: Array<{ trigger: string; next: string; data?: Record<string, string> }> | null;
  default_next?: string | null;
}

let cache: Map<string, NodeConfigRow> | null = null;
let cacheTime = 0;
const CACHE_TTL = 15_000; // 15s — rápido o suficiente para edições refletirem logo

export async function loadFlowConfig(): Promise<Map<string, NodeConfigRow>> {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;

  const { data, error } = await supabase.from('bot_flow_config').select('*');
  if (error) {
    // Tabela ainda não existe (antes da migration): retorna config vazia
    if (error.code === '42P01') return new Map();
    console.warn('[flowConfig] erro ao carregar:', error.message);
    return cache ?? new Map();
  }

  cache = new Map((data || []).map(r => [r.node_id, r as NodeConfigRow]));
  cacheTime = Date.now();
  return cache;
}

export function invalidateFlowCache(): void {
  cache = null;
}

// Converte a string de trigger da config em RegExp.
// Aceita palavras separadas por vírgula OU regex raw.
export function triggerToRegex(triggerStr: string): RegExp {
  const hasRegexChars = /[[\]{}()*+?^$\\]/.test(triggerStr);
  const pattern = hasRegexChars
    ? triggerStr
    : triggerStr.split(',').map(k => k.trim()).filter(Boolean).join('|');
  return new RegExp(pattern, 'i');
}
