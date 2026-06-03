// ═══════════════════════════════════════════════════════════════════════════
//  baileys.ts — Conexão WhatsApp via Baileys.
//  Singleton por processo: uma conexão compartilhada por loja.
//  Sessão persistida em .auth/baileys-session/.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('@whiskeysockets/baileys');

const AUTH_DIR = path.join(process.cwd(), '.auth', 'baileys-session');

export type WaStatus = 'connected' | 'qr_pending' | 'disconnected';

interface WaState {
  status:  WaStatus;
  qr:      string | null;
  storeId: string | null;
}

const _state: WaState = { status: 'disconnected', qr: null, storeId: null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sock: any = null;
let _initializing = false;
let _retryCount   = 0;

const silentLogger = {
  level: 'silent',
  fatal: () => {}, error: () => {}, warn: () => {},
  info:  () => {}, debug: () => {}, trace: () => {},
  child: function() { return this; },
};

export function getWaState(): Readonly<WaState> {
  return { ..._state };
}

export async function initBaileys(storeId: string): Promise<void> {
  if (_sock || _initializing) return;
  _initializing = true;
  _state.storeId = storeId;

  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    _sock = makeWASocket({
      auth:               state,
      printQRInTerminal:  false,
      logger:             silentLogger,
      browser:            ['Fluxo Command', 'Chrome', '1.0.0'],
    });

    _sock.ev.on('creds.update', saveCreds);

    _sock.ev.on('connection.update', async (update: Record<string, unknown>) => {
      const { connection, lastDisconnect, qr } = update as {
        connection?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lastDisconnect?: { error?: any };
        qr?: string;
      };

      if (qr) {
        _state.status = 'qr_pending';
        try {
          _state.qr = await QRCode.toDataURL(qr);
        } catch (_) { _state.qr = null; }
      }

      if (connection === 'open') {
        _state.status = 'connected';
        _state.qr     = null;
        _retryCount   = 0;
        console.log('[Baileys] WhatsApp conectado ✓');
      }

      if (connection === 'close') {
        const code      = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        _state.status   = 'disconnected';
        _sock           = null;
        _initializing   = false;

        if (loggedOut) {
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
          console.log('[Baileys] Sessão encerrada (logout).');
        } else if (_retryCount < 3) {
          _retryCount++;
          console.log(`[Baileys] Reconectando (tentativa ${_retryCount})...`);
          setTimeout(() => initBaileys(storeId), 5000);
          return;
        }
      }
    });

    _sock.ev.on('messages.upsert', async ({ messages, type }: { messages: unknown[]; type: string }) => {
      if (type !== 'notify') return;
      for (const raw of messages) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = raw as any;
        if (!msg.message || msg.key.fromMe) continue;
        const jid = (msg.key.remoteJid as string) || '';
        if (!jid || jid.includes('@g.us') || jid.includes('status@broadcast')) continue;

        const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const text  =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '[mídia]';
        const pushName = (msg.pushName as string) || phone;

        try {
          await supabase.from('wa_messages').insert({
            store_id:  storeId,
            phone,
            direction: 'in',
            text:      text.slice(0, 4096),
            timestamp: new Date().toISOString(),
          });

          const { data: conv } = await supabase
            .from('wa_conversations')
            .select('unread_count')
            .eq('store_id', storeId)
            .eq('phone', phone)
            .maybeSingle();

          await supabase.from('wa_conversations').upsert({
            store_id:     storeId,
            phone,
            name:         pushName,
            last_message: text.slice(0, 100),
            last_time:    new Date().toISOString(),
            unread_count: ((conv?.unread_count as number) || 0) + 1,
          }, { onConflict: 'store_id,phone' });
        } catch (err) {
          console.error('[Baileys] save message error:', err);
        }
      }
    });

  } catch (err) {
    console.error('[Baileys] init error:', err);
    _state.status = 'disconnected';
    _sock         = null;
  } finally {
    _initializing = false;
  }
}

export async function sendWaMessage(phone: string, text: string, storeId: string): Promise<void> {
  if (!_sock || _state.status !== 'connected') {
    throw new Error('WhatsApp não conectado');
  }
  const clean = phone.replace(/\D/g, '');
  const jid   = clean + '@s.whatsapp.net';

  await _sock.sendMessage(jid, { text });

  await supabase.from('wa_messages').insert({
    store_id:  storeId,
    phone:     clean,
    direction: 'out',
    text:      text.slice(0, 4096),
    timestamp: new Date().toISOString(),
  });

  await supabase.from('wa_conversations').upsert({
    store_id:     storeId,
    phone:        clean,
    last_message: text.slice(0, 100),
    last_time:    new Date().toISOString(),
    unread_count: 0,
  }, { onConflict: 'store_id,phone' });
}

export async function disconnectBaileys(): Promise<void> {
  if (_sock) {
    try { await _sock.logout(); } catch (_) {}
    _sock = null;
  }
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
  _state.status  = 'disconnected';
  _state.qr      = null;
  _state.storeId = null;
  _retryCount    = 0;
}
