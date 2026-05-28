import { supabase } from '../lib/supabase';

export function generateWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, '');
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

interface EvoCreds {
  evolution_url:      string;
  evolution_instance: string;
  evolution_token:    string;
}

// Cache de credenciais por store (evita hit no banco a cada mensagem)
const _credCache = new Map<string, { creds: EvoCreds | null; expiresAt: number }>();
const CRED_TTL_MS = 60_000;

async function getEvoCreds(storeId: string): Promise<EvoCreds | null> {
  const now = Date.now();
  const cached = _credCache.get(storeId);
  if (cached && now < cached.expiresAt) return cached.creds;

  const { data } = await supabase
    .from('bot_settings')
    .select('evolution_url, evolution_instance, evolution_token')
    .eq('store_id', storeId)
    .maybeSingle();

  const creds = (data?.evolution_url && data?.evolution_instance && data?.evolution_token)
    ? (data as EvoCreds)
    : null;

  _credCache.set(storeId, { creds, expiresAt: now + CRED_TTL_MS });
  return creds;
}

export function invalidateCredCache(storeId: string): void {
  _credCache.delete(storeId);
}

export async function sendMessage(
  phone: string,
  message: string,
  storeId?: string,
): Promise<{ ok: boolean; error?: string }> {
  console.log(`[messaging] → ${phone}: ${message.slice(0, 80)}...`);

  if (!storeId) {
    console.warn('[messaging] sendMessage called without storeId — skipping real send');
    return { ok: false, error: 'storeId obrigatório para envio real' };
  }

  const creds = await getEvoCreds(storeId);
  if (!creds) {
    console.warn('[messaging] Evolution API não configurado para store', storeId);
    return { ok: false, error: 'Evolution API não configurado' };
  }

  const url = `${creds.evolution_url.replace(/\/$/, '')}/message/sendText/${creds.evolution_instance}`;

  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':       creds.evolution_token,
      },
      body: JSON.stringify({ number: phone, text: message, delay: 1200 }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[messaging] Evolution API error:', resp.status, errText.slice(0, 200));
      return { ok: false, error: `Evolution API: HTTP ${resp.status}` };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[messaging] sendMessage exception:', msg);
    return { ok: false, error: msg };
  }
}

// Normaliza payload do webhook da Evolution API (v1 e v2)
export function parseWebhookPayload(body: unknown): { phone: string; text: string } | null {
  const b = body as Record<string, unknown>;
  if (!b?.data || typeof b.data !== 'object') return null;

  const d = b.data as Record<string, unknown>;

  // Ignora mensagens enviadas pelo próprio bot
  const key = d.key as Record<string, unknown> | undefined;
  if (key?.fromMe === true) return null;

  // Número: remoteJid do Evolution API ou campo legado "from"
  const rawJid = String(key?.remoteJid || d.from || '');
  const phone  = rawJid.replace(/@.+$/, '').replace(/\D/g, '');
  if (!phone) return null;

  // Texto: tenta várias profundidades do payload
  const msg    = d.message as Record<string, unknown> | undefined;
  const text   = (
    (msg?.conversation as string) ||
    ((msg?.extendedTextMessage as Record<string, unknown>)?.text as string) ||
    ((msg?.imageMessage as Record<string, unknown>)?.caption as string) ||
    (d.body as string) ||
    ''
  ).trim();

  if (!text) return null;
  return { phone, text };
}
