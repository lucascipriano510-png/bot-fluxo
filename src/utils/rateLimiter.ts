// Rate limiter em memória — por phone, janela de 1 minuto.
// Reinicia automaticamente quando a janela expira.

const MAX_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MIN ?? 15);

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const b   = buckets.get(phone);

  if (!b || now >= b.resetAt) {
    buckets.set(phone, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (b.count >= MAX_PER_MINUTE) return false;

  b.count++;
  return true;
}
