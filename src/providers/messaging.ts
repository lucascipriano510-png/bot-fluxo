// Abstração de envio de mensagens.
// Troca o provider aqui sem tocar no resto do bot.

export function generateWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, '');
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

// TODO: implementar com Meta WhatsApp Cloud API, Evolution API, etc.
export async function sendMessage(phone: string, message: string): Promise<{ ok: boolean }> {
  console.log(`[messaging] → ${phone}: ${message.slice(0, 60)}...`);
  return { ok: true };
}

// TODO: processar payload do webhook do provider ao receber mensagem
// Estrutura esperada varia por provider. Normalizar aqui.
export function parseWebhookPayload(body: unknown): { phone: string; text: string } | null {
  // Exemplo Evolution API
  const b = body as Record<string, unknown>;
  if (b?.data && typeof b.data === 'object') {
    const d = b.data as Record<string, unknown>;
    const phone = String(d.from || '').replace(/\D/g, '');
    const text = String((d as Record<string, unknown>).body || '').trim();
    if (phone && text) return { phone, text };
  }
  return null;
}
