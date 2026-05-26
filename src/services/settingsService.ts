/**
 * settingsService — lê e grava configurações da loja na tabela bot_settings.
 *
 * SQL necessário (rodar uma vez no Supabase):
 *
 *   CREATE TABLE IF NOT EXISTS bot_settings (
 *     store_id        uuid PRIMARY KEY REFERENCES stores(id),
 *     nome_loja       text,
 *     whatsapp        text,
 *     saudacao        text,
 *     horario_inicio  text DEFAULT '09:00',
 *     horario_fim     text DEFAULT '18:00',
 *     bot_ativo       boolean DEFAULT true,
 *     ignorar_horario boolean DEFAULT false,
 *     fallback_humano boolean DEFAULT true,
 *     delay_resposta  boolean DEFAULT true,
 *     updated_at      timestamptz DEFAULT now()
 *   );
 */

import { supabase } from '../lib/supabase';

export interface BotSettings {
  nome_loja:       string;
  whatsapp:        string;
  saudacao:        string;
  horario_inicio:  string;
  horario_fim:     string;
  bot_ativo:       boolean;
  ignorar_horario: boolean;
  fallback_humano: boolean;
  delay_resposta:  boolean;
}

const DEFAULTS: BotSettings = {
  nome_loja:       process.env.STORE_NAME       || 'Fluxo Outlet',
  whatsapp:        process.env.LOJA_WHATSAPP    || '',
  saudacao:        'Olá! Bem-vindo à Fluxo Outlet! 👋',
  horario_inicio:  process.env.HORARIO_INICIO   || '09:00',
  horario_fim:     process.env.HORARIO_FIM      || '18:00',
  bot_ativo:       true,
  ignorar_horario: process.env.IGNORAR_HORARIO === 'true',
  fallback_humano: true,
  delay_resposta:  true,
};

// Cache rápido para uso no runtime do bot (60 segundos)
let _rtCache: { storeId: string; data: BotSettings; expiresAt: number } | null = null;
const RT_TTL_MS = 60_000;

function mergeDefaults(row: Record<string, unknown>): BotSettings {
  return {
    nome_loja:       (row.nome_loja       as string)  ?? DEFAULTS.nome_loja,
    whatsapp:        (row.whatsapp        as string)  ?? DEFAULTS.whatsapp,
    saudacao:        (row.saudacao        as string)  ?? DEFAULTS.saudacao,
    horario_inicio:  (row.horario_inicio  as string)  ?? DEFAULTS.horario_inicio,
    horario_fim:     (row.horario_fim     as string)  ?? DEFAULTS.horario_fim,
    bot_ativo:       (row.bot_ativo       as boolean) ?? DEFAULTS.bot_ativo,
    ignorar_horario: (row.ignorar_horario as boolean) ?? DEFAULTS.ignorar_horario,
    fallback_humano: (row.fallback_humano as boolean) ?? DEFAULTS.fallback_humano,
    delay_resposta:  (row.delay_resposta  as boolean) ?? DEFAULTS.delay_resposta,
  };
}

export async function loadSettings(storeId: string): Promise<BotSettings> {
  const { data, error } = await supabase
    .from('bot_settings')
    .select('*')
    .eq('store_id', storeId)
    .single();

  if (error || !data) return { ...DEFAULTS };
  return mergeDefaults(data as Record<string, unknown>);
}

export async function saveSettings(
  storeId: string,
  settings: Partial<BotSettings>,
): Promise<void> {
  const { error } = await supabase
    .from('bot_settings')
    .upsert(
      [{ store_id: storeId, ...settings, updated_at: new Date().toISOString() }],
      { onConflict: 'store_id' },
    );
  if (error) throw error;
  // Invalida cache runtime para o próximo request do bot ler os novos valores
  if (_rtCache?.storeId === storeId) _rtCache = null;
}

// ── Leitura em cache para o motor do bot (evita hit no banco a cada mensagem) ─
export async function getRuntimeSettings(storeId: string): Promise<BotSettings> {
  const now = Date.now();
  if (_rtCache && _rtCache.storeId === storeId && now < _rtCache.expiresAt) {
    return _rtCache.data;
  }
  const data = await loadSettings(storeId);
  _rtCache = { storeId, data, expiresAt: now + RT_TTL_MS };
  return data;
}
