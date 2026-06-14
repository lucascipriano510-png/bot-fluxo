// ═══════════════════════════════════════════════════════════════════════════
//  sitePurchaseService — liga compras do site aos leads do CRM (Fase A).
//
//  Núcleo idempotente reusado por:
//   - o cron de sincronização (Fase A, pull)
//   - futuramente, o push em tempo real vindo da Edge Function do site (Fase B)
//
//  Regras de produto definidas com o dono:
//   - Comprador sem lead → cria lead origem 'site'.
//   - Refund (cancelamento) → abate do lifetime_value e marca a compra estornada.
//   - Calor é recalculado automaticamente (updateLeadScore usa total_purchases).
//
//  Multi-tenant: como os pedidos do site não têm store_id, tudo é mapeado para
//  SITE_STORE_ID (o store_id do Fluxo Outlet no CRM). Mesma premissa do
//  inventoryBridge. Mapear múltiplas lojas site→CRM é trabalho futuro.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabase';
import { normalizePhone, phoneVariants } from '../utils/phone';
import { updateLeadScore } from '../services/leadScoreService';
import { recordConversion } from '../services/storeBrainService';
import { fetchSiteOrders, summarizeOrderItems } from '../inventory/sitePurchasesBridge';

export type SiteEventName = 'Purchase' | 'Refund';

export interface SitePurchaseInput {
  phone:       string;
  value:       number;
  produto?:    string;
  name?:       string;        // nome do comprador (para criar lead novo)
  externalRef: string;        // chave de idempotência, ex: 'order:<uuid>'
  source?:     string;        // 'site_cron' | 'site_webhook' | ...
  eventName:   SiteEventName;
  occurredAt?: string;        // ISO; default now
}

export type LinkResult =
  | { status: 'linked';     leadId: string; created: boolean }
  | { status: 'refunded';   leadId: string }
  | { status: 'duplicate' }
  | { status: 'skipped';    reason: string };

// store_id usado para mapear vendas do site. Fallback para STORE_ID legado.
function getSiteStoreId(): string | null {
  return process.env.SITE_STORE_ID || process.env.STORE_ID || null;
}

// Telefones inválidos/placeholder que o site usa quando não há número real.
function isUsablePhone(phone: string): boolean {
  if (!phone) return false;
  if (/^0+$/.test(phone)) return false;       // 00000000000
  return phone.replace(/\D/g, '').length >= 12; // 55 + DDD + número
}

/**
 * Liga uma compra (ou estorno) do site a um lead do CRM. Idempotente por externalRef.
 */
export async function linkSitePurchaseToLead(input: SitePurchaseInput): Promise<LinkResult> {
  const storeId = getSiteStoreId();
  if (!storeId) return { status: 'skipped', reason: 'SITE_STORE_ID não configurado' };

  const phone = normalizePhone(String(input.phone || ''));
  if (!isUsablePhone(phone)) return { status: 'skipped', reason: 'telefone inválido' };

  const when = input.occurredAt || new Date().toISOString();
  const source = input.source || 'site_cron';

  // ── ESTORNO ────────────────────────────────────────────────────────────────
  if (input.eventName === 'Refund') {
    const { data: existing } = await supabase
      .from('lead_purchases')
      .select('id, lead_id, valor, refunded_at')
      .eq('store_id', storeId)
      .eq('external_ref', input.externalRef)
      .maybeSingle();

    // Sem compra registrada ou já estornada → nada a fazer.
    if (!existing || existing.refunded_at) return { status: 'duplicate' };

    await supabase
      .from('lead_purchases')
      .update({ refunded_at: when })
      .eq('id', existing.id);

    if (existing.lead_id) {
      const { data: lead } = await supabase
        .from('bot_leads')
        .select('total_purchases, lifetime_value')
        .eq('id', existing.lead_id)
        .eq('store_id', storeId)
        .single();
      if (lead) {
        await supabase
          .from('bot_leads')
          .update({
            total_purchases: Math.max(0, (lead.total_purchases || 0) - 1),
            lifetime_value:  Math.max(0, Number(lead.lifetime_value || 0) - Number(existing.valor || 0)),
            atualizado_em:   new Date().toISOString(),
          })
          .eq('id', existing.lead_id)
          .eq('store_id', storeId);
        await updateLeadScore(storeId, existing.lead_id);
      }
      return { status: 'refunded', leadId: existing.lead_id };
    }
    return { status: 'refunded', leadId: '' };
  }

  // ── COMPRA ───────────────────────────────────────────────────────────────────
  // Dedup: se essa venda já foi registrada, não conta de novo.
  const { data: dup } = await supabase
    .from('lead_purchases')
    .select('id')
    .eq('store_id', storeId)
    .eq('external_ref', input.externalRef)
    .maybeSingle();
  if (dup) return { status: 'duplicate' };

  // Acha o lead pelo TELEFONE REAL (phone_real), tolerante ao 9º dígito.
  // Fallback para `phone` cobre leads que já nasceram com número real (origem
  // 'site'). Leads de WhatsApp guardam o LID em `phone` e o número em phone_real.
  const variants = phoneVariants(phone);
  const inList = `(${variants.join(',')})`;
  const { data: matches } = await supabase
    .from('bot_leads')
    .select('id, total_purchases, lifetime_value')
    .eq('store_id', storeId)
    .or(`phone_real.in.${inList},phone.in.${inList}`)
    .limit(1);
  let lead = matches?.[0] || null;

  let created = false;
  if (!lead) {
    const { data: novo, error: insErr } = await supabase
      .from('bot_leads')
      .insert({
        store_id:         storeId,
        phone,
        phone_real:       phone,
        nome:             input.name?.trim() || null,
        origem:           'site',
        status:           'concluido',
        status_comercial: 'CONVERTIDO',
        kanban_stage:     'finalizado',
        first_contact_at: when,
        last_interaction_at: when,
        qualificado_em:   when,
        atualizado_em:    new Date().toISOString(),
      })
      .select('id, total_purchases, lifetime_value')
      .single();
    if (insErr || !novo) return { status: 'skipped', reason: insErr?.message || 'falha ao criar lead' };
    lead = novo;
    created = true;
  }

  // Registra a compra (idempotente via índice único em external_ref).
  const { error: purErr } = await supabase.from('lead_purchases').insert({
    store_id:     storeId,
    lead_id:      lead.id,
    phone,
    produto:      input.produto || 'Compra no site',
    valor:        input.value || null,
    data_compra:  when,
    source,
    external_ref: input.externalRef,
  });
  // Corrida: outra execução inseriu primeiro → trata como duplicata.
  if (purErr) {
    if ((purErr as { code?: string }).code === '23505') return { status: 'duplicate' };
    return { status: 'skipped', reason: purErr.message };
  }

  // Atualiza métricas do lead + marca como convertido (espelha /leads/:id/convert).
  await supabase
    .from('bot_leads')
    .update({
      total_purchases:  (lead.total_purchases || 0) + 1,
      lifetime_value:   Number(lead.lifetime_value || 0) + Number(input.value || 0),
      status:           'concluido',
      status_comercial: 'CONVERTIDO',
      kanban_stage:     'finalizado',
      atualizado_em:    new Date().toISOString(),
    })
    .eq('id', lead.id)
    .eq('store_id', storeId);

  await updateLeadScore(storeId, lead.id);
  recordConversion(storeId, phone, 'human_converted').catch(() => {});

  return { status: 'linked', leadId: lead.id, created };
}

// ── Orquestrador (Fase A): varre os pedidos do site e aplica ao CRM ─────────────
export interface SyncSummary {
  ok: boolean;
  scanned: number;
  linked: number;
  created: number;
  refunded: number;
  duplicate: number;
  skipped: number;
  reason?: string;
}

export async function syncSitePurchases(limit = 500): Promise<SyncSummary> {
  const storeId = getSiteStoreId();
  if (!storeId) {
    return { ok: false, scanned: 0, linked: 0, created: 0, refunded: 0, duplicate: 0, skipped: 0, reason: 'SITE_STORE_ID não configurado' };
  }

  const orders = await fetchSiteOrders(limit);
  const summary: SyncSummary = { ok: true, scanned: orders.length, linked: 0, created: 0, refunded: 0, duplicate: 0, skipped: 0 };

  for (const order of orders) {
    const eventName: SiteEventName = order.status === 'CANCELADO' ? 'Refund' : 'Purchase';
    const result = await linkSitePurchaseToLead({
      phone:       order.phone || '',
      value:       Number(order.value || 0),
      produto:     summarizeOrderItems(order.items),
      name:        order.name || undefined,
      externalRef: `order:${order.id}`,
      source:      'site_cron',
      eventName,
      occurredAt:  order.updated_at || order.created_at || undefined,
    });

    switch (result.status) {
      case 'linked':    summary.linked++; if (result.created) summary.created++; break;
      case 'refunded':  summary.refunded++; break;
      case 'duplicate': summary.duplicate++; break;
      case 'skipped':   summary.skipped++; break;
    }
  }

  console.log('[sitePurchaseService] sync concluído:', JSON.stringify(summary));
  return summary;
}
