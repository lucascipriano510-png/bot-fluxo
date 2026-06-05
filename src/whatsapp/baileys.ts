// baileys.ts — Real quando ENABLE_BAILEYS=true (Render/Railway/VPS).
// Sem a variável, retorna stub 'unavailable' (compatível com Vercel serverless).

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

export function getWaState() {
  return { status: _status, qr: _qr, storeId: null };
}

export async function initBaileys(storeId: string): Promise<void> {
  if (!ENABLED) return;
  if (_initializing) return;
  if (_socket && (_status === 'connected' || _status === 'qr_pending')) return;

  _initializing = true;
  try {
    const B = await import('@whiskeysockets/baileys') as any;
    const makeWASocket = B.default ?? B.makeWASocket ?? B;
    const { useMultiFileAuthState, DisconnectReason } = B;

    const { state, saveCreds } = await useMultiFileAuthState('./baileys-auth');

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

    _socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';
        const phone = (msg.key.remoteJid || '')
          .replace('@s.whatsapp.net', '')
          .replace(/@.*/, '');
        if (!text || !phone) continue;

        const ts = new Date(Number(msg.messageTimestamp) * 1000).toISOString();

        await supabase.from('wa_messages').insert({
          store_id: storeId, phone, direction: 'in', text, timestamp: ts,
        }).then(null, () => {});

        const { data: existing } = await supabase
          .from('wa_conversations')
          .select('unread_count')
          .eq('store_id', storeId)
          .eq('phone', phone)
          .single();

        await supabase.from('wa_conversations').upsert({
          store_id: storeId,
          phone,
          last_message: text,
          last_time: ts,
          unread_count: (existing?.unread_count || 0) + 1,
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
    store_id: storeId,
    phone,
    last_message: text,
    last_time: ts,
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
