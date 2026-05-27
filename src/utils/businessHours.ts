// Verifica se estamos dentro do horário de atendimento da loja.
// Recebe os settings da loja como fonte primária.
// Env vars (HORARIO_INICIO, HORARIO_FIM, DIAS_UTEIS, TIMEZONE) são fallback apenas para
// deploy single-store legado — nunca devem ser a fonte principal no modo SaaS.

interface HoursSettings {
  horario_inicio:  string;
  horario_fim:     string;
  ignorar_horario: boolean;
}

const TZ       = process.env.TIMEZONE  ?? 'America/Sao_Paulo';
const WORK_DAYS = (process.env.DIAS_UTEIS ?? '1,2,3,4,5,6').split(',').map(Number);

export function isBusinessHours(settings?: HoursSettings): boolean {
  if (settings?.ignorar_horario) return true;

  const inicio = settings?.horario_inicio ?? process.env.HORARIO_INICIO ?? '09:00';
  const fim    = settings?.horario_fim    ?? process.env.HORARIO_FIM    ?? '18:00';

  const [sh, sm] = inicio.split(':').map(Number);
  const [eh, em] = fim.split(':').map(Number);

  const now  = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day  = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  return WORK_DAYS.includes(day) && mins >= sh * 60 + sm && mins < eh * 60 + em;
}

export function openingTimeStr(settings?: Pick<HoursSettings, 'horario_inicio'>): string {
  const inicio = settings?.horario_inicio ?? process.env.HORARIO_INICIO ?? '09:00';
  const [h, m] = inicio.split(':');
  return `${String(h).padStart(2, '0')}:${String(m || '0').padStart(2, '0')}`;
}
