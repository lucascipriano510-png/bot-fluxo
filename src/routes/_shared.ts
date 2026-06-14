// Helpers compartilhados pelos routers da API.

// Auth de cron: aceita header x-cron-secret (chamada manual/Render) OU
// Authorization: Bearer <CRON_SECRET> (formato que o Vercel Cron envia).
export function cronAuthorized(req: { headers: Record<string, unknown> }): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  if (req.headers['x-cron-secret'] === secret) return true;
  const auth = String(req.headers['authorization'] || '');
  return auth === `Bearer ${secret}`;
}

// Extrai mensagem legível de qualquer erro (Error, objeto Supabase, etc.).
export function errMsg(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.details === 'string') return e.details;
    if (typeof e.hint   === 'string') return e.hint;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

// True quando o erro do Supabase indica tabela inexistente (migração pendente).
export function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || (err.message ?? '').includes('does not exist');
}

// Base e auth para chamar as Edge Functions do Supabase.
export const EDGE_BASE = () => `${process.env.SUPABASE_URL}/functions/v1`;
export const EDGE_AUTH = () => `Bearer ${process.env.SUPABASE_ANON_KEY}`;
