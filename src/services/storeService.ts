import { supabase } from '../lib/supabase';

export interface StoreContext {
  storeId: string;
  slug: string;
  name: string;
  whatsappNumber: string;
}

// Cache por chave composta — múltiplas lojas na mesma instância
const _cache = new Map<string, StoreContext>();

function fromRow(row: { id: string; slug: string; name: string; whatsapp_number: string }): StoreContext {
  return { storeId: row.id, slug: row.slug, name: row.name, whatsappNumber: row.whatsapp_number };
}

function setCache(ctx: StoreContext) {
  _cache.set(`wa:${ctx.whatsappNumber}`, ctx);
  _cache.set(`slug:${ctx.slug}`, ctx);
  _cache.set(`id:${ctx.storeId}`, ctx);
}

export async function getStoreBySlug(slug: string): Promise<StoreContext> {
  const key = `slug:${slug}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const { data, error } = await supabase
    .from('stores')
    .select('id, slug, name, whatsapp_number')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error || !data) throw new Error(`[storeService] Loja não encontrada para slug "${slug}"`);
  const ctx = fromRow(data);
  setCache(ctx);
  return ctx;
}

export async function getStoreById(id: string): Promise<StoreContext> {
  const key = `id:${id}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const { data, error } = await supabase
    .from('stores')
    .select('id, slug, name, whatsapp_number')
    .eq('id', id)
    .eq('is_active', true)
    .single();

  if (error || !data) throw new Error(`[storeService] Loja não encontrada para id "${id}"`);
  const ctx = fromRow(data);
  setCache(ctx);
  return ctx;
}

export async function getStoreByWhatsapp(phone: string): Promise<StoreContext> {
  const key = `wa:${phone}`;
  if (_cache.has(key)) return _cache.get(key)!;

  const { data, error } = await supabase
    .from('stores')
    .select('id, slug, name, whatsapp_number')
    .eq('whatsapp_number', phone)
    .eq('is_active', true)
    .single();

  if (error || !data) throw new Error(`[storeService] Loja não encontrada para WhatsApp ${phone}`);
  const ctx = fromRow(data);
  setCache(ctx);
  return ctx;
}

// Backward compat — usa LOJA_WHATSAPP do ambiente (instância única)
export async function getStoreContext(): Promise<StoreContext> {
  const whatsapp = process.env.LOJA_WHATSAPP;
  if (!whatsapp) throw new Error('[storeService] LOJA_WHATSAPP não definido no ambiente');
  return getStoreByWhatsapp(whatsapp);
}

export function clearStoreCache(): void {
  _cache.clear();
}
