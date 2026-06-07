// baileys.ts — Real quando ENABLE_BAILEYS=true (Render/Railway/VPS).
// Sem a variável, retorna stub 'unavailable' (compatível com Vercel serverless).
// MODO OBSERVADOR — nunca responder automaticamente

import { supabase } from '../lib/supabase';
import qrcode from 'qrcode';

export type WaStatus = 'connected' | 'qr_pending' | 'disconnected' | 'unavailable';

const ENABLED = process.env.ENABLE_BAILEYS === 'true';

let _status: WaStatus = ENABLED ? 'disconnected' : 'unavailable';
let _qr: string | null = null;
let _socket: any = null;
let _initializing = false;

const silentLogger = {
  level: 'silent' as const,
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {},
  error: console.error, fatal: console.error,
  child() { return this; },
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    const f = num.length === 9
      ? `${num.slice(0, 5)}-${num.slice(5)}`
      : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `+55 (${ddd}) ${f}`;
  }
  return digits ? `+${digits}` : raw;
}

function resolveName(msg: any, phone: string): string {
  if (msg.pushName) return msg.pushName;
  const jid = msg.key.remoteJid || '';
  if (_socket?.contacts) {
    const c = _socket.contacts[jid];
    if (c?.name) return c.name;
    if (c?.notify) return c.notify;
  }
  return formatPhone(phone);
}

async function upsertLeadFromInbox(
  storeId: string,
  phone: string,
  name: string,
  firstMessage: string,
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('bot_leads')
      .select('id')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      await supabase.from('bot_leads')
        .update({ atualizado_em: new Date().toISOString() })
        .eq('id', existing.id);
      return existing.id as string;
    }

    const { data: created } = await supabase.from('bot_leads').insert({
      store_id:         storeId,
      phone,
      nome:             name,
      origem:           'whatsapp_inbox',
      status_comercial: 'FRIO',
      interesse:        firstMessage.slice(0, 100),
      kanban_stage:     'novo',
      status:           'novo',
      qualificado_em:   new Date().toISOString(),
      atualizado_em:    new Date().toISOString(),
    }).select('id').single();

    return (created?.id as string) || null;
  } catch {
    return null;
  }
}

export function getWaState() {
  return { status: _status, qr: _qr, storeId: null };
}

async function useSupabaseAuthState(storeId: string) {
  const B = await import('@whiskeysockets/baileys') as any;
  const { initAuthCreds, BufferJSON, proto } = B;

  async function readData(key: string) {
    const { data } = await supabase
      .from('baileys_auth')
      .select('value')
      .eq('store_id', storeId)
      .eq('key', key)
      .maybeSingle();
    if (!data) return null;
    return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
  }

  async function writeData(key: string, value: any) {
    await supabase.from('baileys_auth').upsert({
      store_id: storeId,
      key,
      value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
    }, { onConflict: 'store_id,key' });
  }

  async function removeData(key: string) {
    await supabase.from('baileys_auth')
      .delete()
      .eq('store_id', storeId)
      .eq('key', key);
  }

  const creds = (await readData('creds')) || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, any> = {};
        await Promise.all(ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          result[id] = value;
        }));
        return result;
      },
      set: async (data: Record<string, Record<string, any>>) => {
        await Promise.all(
          Object.entries(data).flatMap(([category, entries]) =>
            Object.entries(entries).map(([id, value]) => {
              const key = `${category}-${id}`;
              return value ? writeData(key, value) : removeData(key);
            })
          )
        );
      },
    },
  };

  return {
    state,
    saveCreds: () => writeData('creds', state.creds),
  };
}

export async function initBaileys(storeId: string): Promise<void> {
  if (!ENABLED) return;
  if (_initializing) return;
  if (_socket && (_status === 'connected' || _status === 'qr_pending')) return;

  _initializing = true;
  try {
    const B = await import('@whiskeysockets/baileys') as any;
    const makeWASocket = B.default ?? B.makeWASocket ?? B;
    const { DisconnectReason } = B;

    const { state, saveCreds } = await useSupabaseAuthState(storeId);

    _socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger as any,
      browser: ['Fluxo Command', 'Chrome', '1.0'],
    });

    _socket.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        _status = 'qr_pending';
        _qr = await qrcode.toDataURL(qr).catch(() => qr);
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        _status = 'disconnected';
        _qr = null;
        _socket = null;
        _initializing = false;
        if (!loggedOut) setTimeout(() => initBaileys(storeId), 5000);
      } else if (connection === 'open') {
        _status = 'connected';
        _qr = null;
        _initializing = false;
      }
    });

    _socket.ev.on('creds.update', saveCreds);

    // MODO OBSERVADOR — nunca responder automaticamente
    _socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue; // ignorar mensagens enviadas pelo próprio número

        const jid = msg.key.remoteJid || '';
        // Ignorar grupos completamente — só processar contatos privados
        if (jid.endsWith('@g.us')) continue;

        const phone = jid.replace('@s.whatsapp.net', '').replace(/@.*/, '');

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';

        if (!text || !phone) continue;

        const ts = new Date(Number(msg.messageTimestamp) * 1000).toISOString();
        const name = resolveName(msg, phone);

        // CRM: cria ou atualiza lead (só chegam contatos privados aqui)
        const leadId = await upsertLeadFromInbox(storeId, phone, name, text);

        await supabase.from('wa_messages').insert({
          store_id: storeId, phone, direction: 'in', text, timestamp: ts, lead_id: leadId,
        }).then(null, () => {});

        const { data: existingConv } = await supabase
          .from('wa_conversations')
          .select('unread_count')
          .eq('store_id', storeId)
          .eq('phone', phone)
          .single();

        await supabase.from('wa_conversations').upsert({
          store_id:     storeId,
          phone,
          name,
          last_message: text,
          last_time:    ts,
          is_group:     false,
          lead_id:      leadId,
          unread_count: (existingConv?.unread_count || 0) + 1,
        }, { onConflict: 'store_id,phone' }).then(null, () => {});
      }
    });

  } catch (err) {
    console.error('[Baileys] init error:', err);
    _status = 'unavailable';
    _initializing = false;
  }
}

export async function sendWaMessage(phone: string, text: string, storeId: string): Promise<void> {
  if (!ENABLED || !_socket || _status !== 'connected') {
    throw new Error('WhatsApp não conectado.');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await _socket.sendMessage(jid, { text });

  const ts = new Date().toISOString();
  await supabase.from('wa_messages').insert({
    store_id: storeId, phone, direction: 'out', text, timestamp: ts,
  }).then(null, () => {});

  await supabase.from('wa_conversations').upsert({
    store_id:     storeId,
    phone,
    last_message: text,
    last_time:    ts,
    unread_count: 0,
  }, { onConflict: 'store_id,phone' }).then(null, () => {});
}

export async function disconnectBaileys(): Promise<void> {
  if (_socket) {
    await _socket.logout().catch(() => _socket?.end?.());
    _socket = null;
  }
  _status = ENABLED ? 'disconnected' : 'unavailable';
  _qr = null;
  _initializing = false;
}
