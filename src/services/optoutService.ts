import { supabase } from '../lib/supabase';

export async function isOptedOut(storeId: string, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('bot_optouts')
    .select('phone')
    .eq('store_id', storeId)
    .eq('phone', phone)
    .maybeSingle();
  return !!data;
}

export async function registerOptOut(storeId: string, phone: string): Promise<void> {
  await supabase
    .from('bot_optouts')
    .upsert([{ store_id: storeId, phone }], { onConflict: 'store_id,phone' });

  // Remove dados do lead e reinicia sessão (LGPD — apenas nesta loja)
  await Promise.all([
    supabase.from('bot_leads').delete().eq('store_id', storeId).eq('phone', phone),
    supabase
      .from('bot_sessions')
      .update({ current_node: 'INICIO', context: {}, atualizado_em: new Date().toISOString() })
      .eq('store_id', storeId)
      .eq('phone', phone),
  ]);
}

export async function removeOptOut(storeId: string, phone: string): Promise<void> {
  await supabase
    .from('bot_optouts')
    .delete()
    .eq('store_id', storeId)
    .eq('phone', phone);
}
