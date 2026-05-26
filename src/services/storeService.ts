import { supabase } from '../lib/supabase';

export interface StoreContext {
  storeId: string;       // UUID — chave para tabelas bot_*
  slug: string;          // slug legível — chave para catálogo/InventoryBridge
  name: string;          // nome exibido nas mensagens
  whatsappNumber: string;
}

let _cached: StoreContext | null = null;

/**
 * Descobre a loja atual pelo número de WhatsApp configurado (LOJA_WHATSAPP).
 * Resultado é cacheado em memória — muda apenas com redeploy.
 *
 * REGRA: nenhuma consulta ao banco ocorre sem store_id.
 * Esta função é a única fonte de verdade do store_id no runtime do bot.
 */
export async function getStoreContext(): Promise<StoreContext> {
  if (_cached) return _cached;

  const whatsapp = process.env.LOJA_WHATSAPP;
  if (!whatsapp) throw new Error('[storeService] LOJA_WHATSAPP não definido no ambiente');

  const { data, error } = await supabase
    .from('stores')
    .select('id, slug, name, whatsapp_number')
    .eq('whatsapp_number', whatsapp)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error(
      `[storeService] Loja não encontrada para WhatsApp ${whatsapp}. ` +
      `Execute BOT_SUPABASE_MIGRATION_5.sql e verifique a tabela stores.`
    );
  }

  _cached = {
    storeId:        data.id,
    slug:           data.slug,
    name:           data.name,
    whatsappNumber: data.whatsapp_number,
  };

  return _cached;
}

/** Limpa o cache (útil em testes). */
export function clearStoreCache(): void {
  _cached = null;
}
