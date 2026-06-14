/**
 * sitePurchasesBridge — READ-ONLY bridge entre o CRM e os pedidos do site.
 * Zero escrita: nenhum INSERT, UPDATE ou DELETE no banco do site.
 *
 * Espelha o padrão de `inventoryBridge.ts`:
 * - Usa SITE_SUPABASE_URL + SITE_SUPABASE_ANON_KEY (anon key, somente leitura).
 * - A tabela `orders` do site permite SELECT para anon (RLS), ao contrário de
 *   `rastreio_conversoes`, que só libera para `authenticated`.
 *
 * Fonte canônica de venda real no site:
 * - status 'CONCLUÍDO' → compra confirmada (admin baixou estoque + disparou CAPI)
 * - status 'CANCELADO' → venda cancelada/estornada
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Linha bruta da tabela `orders` no Supabase do site.
export interface SiteOrderRow {
  id:           string;
  order_number: string | null;
  name:         string | null;
  phone:        string | null;
  items:        Array<{ name?: string; qty?: number; quantity?: number }> | null;
  value:        number | null;
  status:       string | null;
  created_at:   string | null;
  updated_at:   string | null;
}

const ORDER_SELECT = 'id,order_number,name,phone,items,value,status,created_at,updated_at';

let _siteClient: SupabaseClient | null = null;

function getSiteClient(): SupabaseClient | null {
  if (_siteClient) return _siteClient;
  const url = process.env.SITE_SUPABASE_URL;
  const key = process.env.SITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[sitePurchasesBridge] SITE_SUPABASE_URL ou SITE_SUPABASE_ANON_KEY não configurados — integração de compras desativada');
    return null;
  }
  _siteClient = createClient(url, key);
  return _siteClient;
}

/**
 * Lê os pedidos finalizados/cancelados do site (mais recentes primeiro).
 * Sem watermark: a idempotência é garantida pelo external_ref no CRM. Como o
 * volume de uma loja local é baixo, varrer os N pedidos mais recentes e deixar
 * o dedup filtrar é seguro e barato. (Watermark vira otimização futura.)
 */
export async function fetchSiteOrders(limit = 500): Promise<SiteOrderRow[]> {
  const client = getSiteClient();
  if (!client) return [];

  const { data, error } = await client
    .from('orders')
    .select(ORDER_SELECT)
    .in('status', ['CONCLUÍDO', 'CANCELADO'])
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('[sitePurchasesBridge] erro ao ler orders do site:', error.message);
    return [];
  }
  return (data || []) as SiteOrderRow[];
}

// Resume os itens do pedido em um nome de produto legível para o lead_purchases.
export function summarizeOrderItems(items: SiteOrderRow['items']): string {
  if (!Array.isArray(items) || items.length === 0) return 'Compra no site';
  const first = String(items[0]?.name || 'Produto').trim();
  return items.length > 1 ? `${first} (+${items.length - 1} item(ns))` : first;
}
