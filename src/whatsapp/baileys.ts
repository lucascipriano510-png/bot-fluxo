// baileys.ts — Real quando ENABLE_BAILEYS=true (Render/Railway/VPS).
// Sem a variável, retorna stub 'unavailable' (compatível com Vercel serverless).
// MODO OBSERVADOR — nunca responder automaticamente

import { supabase } from '../lib/supabase';
import qrcode from 'qrcode';
import { normalizePhone } from '../utils/phone';

export type WaStatus = 'connected' | 'qr_pending' | 'disconnected' | 'unavailable';

const ENABLED = process.env.ENABLE_BAILEYS === 'true';

let _status: WaStatus = ENABLED ? 'disconnected' : 'unavailable';
let _qr: string | null = null;
let _socket: any = null;
let _initializing = false;
let _disconnectedAt: Date | null = null;

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

// Resolve o TELEFONE REAL (PN) a partir da mensagem, mesmo quando o WhatsApp
// endereça por LID (remoteJid termina em @lid e esconde o número).
//   1) Se remoteJid já é @s.whatsapp.net → é o próprio número.
//   2) Se é @lid → usa remoteJidAlt (o JID de telefone que o servidor manda junto).
//   3) Fallback → consulta o mapeamento LID→PN do Baileys.
// Retorna dígitos normalizados (55+DDD+número) ou null se não conseguir resolver.
async function resolvePhoneReal(msg: any): Promise<string | null> {
  try {
    const jid: string = msg?.key?.remoteJid || '';
    if (!jid) return null;
    if (jid.endsWith('@s.whatsapp.net')) return normalizePhone(jid);

    if (jid.endsWith('@lid')) {
      const alt: string = msg?.key?.remoteJidAlt || '';
      if (alt.endsWith('@s.whatsapp.net')) return normalizePhone(alt);

      const pnJid: string | null = await _socket?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pnJid && pnJid.endsWith('@s.whatsapp.net')) return normalizePhone(pnJid);
    }
  } catch (err) {
    console.warn('[Baileys] resolvePhoneReal falhou:', (err as Error)?.message);
  }
  return null;
}

async function upsertLeadFromInbox(
  storeId: string,
  phone: string,
  name: string,
  firstMessage: string,
  phoneReal?: string | null,
): Promise<string | null> {
  try {
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from('bot_leads')
      .select('id, nome, message_count, phone_real')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, unknown> = {
        atualizado_em:   now,
        last_message_at: now,
        message_count:   (existing.message_count || 0) + 1,
      };
      // Atualiza nome se antes era só o número e agora temos pushName
      if (name && name !== phone && (!existing.nome || existing.nome === phone)) {
        updates.nome = name;
      }
      // Preenche o telefone real assim que conseguimos resolvê-lo (backfill incremental)
      if (phoneReal && !existing.phone_real) {
        updates.phone_real = phoneReal;
      }
      await supabase.from('bot_leads').update(updates).eq('id', existing.id);
      console.log('[CRM] Lead atualizado:', phone, '| msgs:', updates.message_count);
      return existing.id as string;
    }

    const { data: created, error: insertErr } = await supabase.from('bot_leads').insert({
      store_id:         storeId,
      phone,
      phone_real:       phoneReal || null,
      nome:             name,
      origem:           'whatsapp_inbox',
      status_comercial: 'FRIO',
      interesse:        firstMessage.slice(0, 200),
      kanban_stage:     'novo',
      status:           'qualificado',
      message_count:    1,
      last_message_at:  now,
      qualificado_em:   now,
      atualizado_em:    now,
    }).select('id').single();

    if (insertErr) throw insertErr;
    console.log('[CRM] Lead criado:', phone, '| nome:', name);
    return (created?.id as string) || null;
  } catch (err: unknown) {
    console.error('[CRM] ERRO ao criar/atualizar lead:', {
      storeId, phone,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    });
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
        if (!loggedOut) {
          _disconnectedAt = new Date();
          setTimeout(() => initBaileys(storeId), 5000);
        } else {
          _disconnectedAt = null;
        }
      } else if (connection === 'open') {
        _status = 'connected';
        _qr = null;
        _initializing = false;

        const operatorPhone = process.env.OPERATOR_PHONE;
        if (operatorPhone && _disconnectedAt) {
          const fell = _disconnectedAt;
          _disconnectedAt = null;
          const sock = _socket;
          setTimeout(async () => {
            try {
              const opJid = normalizePhone(operatorPhone) + '@s.whatsapp.net';
              const ts = fell.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
              await sock.sendMessage(opJid, { text: `⚠️ Fluxo Command: WhatsApp ficou offline em ${ts}.` });
              await sock.sendMessage(opJid, { text: `✅ Fluxo Command: WhatsApp reconectado com sucesso.` });
            } catch (e) {
              console.error('[alert] Erro ao enviar alerta ao operador:', e);
            }
          }, 3000);
        } else {
          _disconnectedAt = null;
        }
      }
    });

    _socket.ev.on('creds.update', saveCreds);

    // MODO OBSERVADOR — nunca responder automaticamente
    _socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const jid = msg.key.remoteJid || '';
        // Ignorar grupos e broadcasts — só processar contatos privados
        if (jid.endsWith('@g.us')) continue;
        if (jid === 'status@broadcast') continue;

        const phone = normalizePhone(jid);

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';

        if (!text || !phone) continue;

        const ts = new Date(Number(msg.messageTimestamp) * 1000).toISOString();

        if (msg.key.fromMe) {
          // Mensagem enviada pelo celular — salva como saída, sem criar lead, sem unread
          await supabase.from('wa_messages').insert({
            store_id: storeId, phone, direction: 'out', text, timestamp: ts,
          }).then(null, () => {});

          await supabase.from('wa_conversations').upsert({
            store_id:     storeId,
            phone,
            last_message: text,
            last_time:    ts,
            is_group:     false,
          }, { onConflict: 'store_id,phone' }).then(null, () => {});
          continue;
        }

        // Mensagem recebida — comportamento completo
        const name = resolveName(msg, phone);
        const phoneReal = await resolvePhoneReal(msg);
        const leadId = await upsertLeadFromInbox(storeId, phone, name, text, phoneReal);

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
  const normalizedPhone = normalizePhone(phone);
  const jid = normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@s.whatsapp.net`;
  await _socket.sendMessage(jid, { text });

  const ts = new Date().toISOString();
  await supabase.from('wa_messages').insert({
    store_id: storeId, phone: normalizedPhone, direction: 'out', text, timestamp: ts,
  }).then(null, () => {});

  await supabase.from('wa_conversations').upsert({
    store_id:     storeId,
    phone:        normalizedPhone,
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
