/**
 * siteLeadSignalsBridge — READ-ONLY bridge entre o CRM e os sinais de lead do site.
 * Zero escrita: nenhum INSERT/UPDATE/DELETE no banco do site.
 *
 * Espelha `sitePurchasesBridge.ts`:
 * - Usa SITE_SUPABASE_URL + SITE_SUPABASE_ANON_KEY (anon key, somente leitura).
 * - A tabela `site_lead_signals` libera SELECT para anon (RLS).
 *
 * O site emite sinais ricos (produto_visto, whatsapp_produto, carrinho_add,
 * checkout_aberto, telefone_informado) com detalhe do produto. Aqui só lemos.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SiteLeadSignalRow {
  id: string;
  visitor_id: string | null;
  phone: string | null;
  name: string | null;
  event: string | null;
  product_id: string | null;
  product_sku: string | null;
  product_name: string | null;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  size: string | null;
  brand: string | null;
  material: string | null;
  price: number | null;
  qty: number | null;
  cart_json: unknown;
  meta: unknown;
  created_at: string | null;
}

const SELECT = 'id,visitor_id,phone,name,event,product_id,product_sku,product_name,category,subcategory,color,size,brand,material,price,qty,cart_json,meta,created_at';

let _siteClient: SupabaseClient | null = null;
function getSiteClient(): SupabaseClient | null {
  if (_siteClient) return _siteClient;
  const url = process.env.SITE_SUPABASE_URL;
  const key = process.env.SITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[siteLeadSignalsBridge] SITE_SUPABASE_URL/ANON_KEY ausentes — sinais de lead desativados');
    return null;
  }
  _siteClient = createClient(url, key);
  return _siteClient;
}

// Gera candidatos de telefone p/ casar com o que o site grava (sem 55, com/sem 9º dígito).
function phoneCandidates(...raws: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const raw of raws) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) continue;
    set.add(d);
    set.add(d.replace(/^55/, ''));          // tira DDI
    if (d.length >= 11) set.add(d.slice(-11)); // DDD + 9 + número
    if (d.length >= 10) set.add(d.slice(-10)); // DDD + número (sem 9)
    if (d.length >= 8) set.add(d.slice(-8));    // número local
  }
  return Array.from(set).filter(Boolean);
}

/** Lê os sinais do site para um telefone (tolerante a variações). */
export async function fetchSignalsByPhone(
  phoneReal?: string | null,
  phoneLid?: string | null,
  limit = 200,
): Promise<SiteLeadSignalRow[]> {
  const client = getSiteClient();
  if (!client) return [];
  const candidates = phoneCandidates(phoneReal, phoneLid);
  if (candidates.length === 0) return [];
  const { data, error } = await client
    .from('site_lead_signals')
    .select(SELECT)
    .in('phone', candidates)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[siteLeadSignalsBridge] erro ao ler sinais:', error.message);
    return [];
  }
  return (data || []) as SiteLeadSignalRow[];
}

/** Sinais recentes com telefone (para o sino / fila de leads acionáveis). */
export async function fetchRecentSignals(sinceISO: string, limit = 300): Promise<SiteLeadSignalRow[]> {
  const client = getSiteClient();
  if (!client) return [];
  const { data, error } = await client
    .from('site_lead_signals')
    .select(SELECT)
    .not('phone', 'is', null)
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[siteLeadSignalsBridge] erro ao ler sinais recentes:', error.message);
    return [];
  }
  return (data || []) as SiteLeadSignalRow[];
}
