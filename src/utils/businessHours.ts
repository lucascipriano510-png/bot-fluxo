// Verifica se estamos dentro do horário de atendimento da loja.
// Configure via .env: HORARIO_INICIO, HORARIO_FIM, DIAS_UTEIS, TIMEZONE

const START_HOUR = Number((process.env.HORARIO_INICIO ?? '09:00').split(':')[0]);
const START_MIN  = Number((process.env.HORARIO_INICIO ?? '09:00').split(':')[1]);
const END_HOUR   = Number((process.env.HORARIO_FIM   ?? '18:00').split(':')[0]);
const END_MIN    = Number((process.env.HORARIO_FIM   ?? '18:00').split(':')[1]);
// 0=Dom, 1=Seg ... 6=Sáb — padrão Seg-Sáb
const WORK_DAYS  = (process.env.DIAS_UTEIS ?? '1,2,3,4,5,6').split(',').map(Number);
const TZ         = process.env.TIMEZONE ?? 'America/Sao_Paulo';

export function isBusinessHours(): boolean {
  if (process.env.IGNORAR_HORARIO === 'true') return true;
  const now  = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day  = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  return WORK_DAYS.includes(day) && mins >= START_HOUR * 60 + START_MIN && mins < END_HOUR * 60 + END_MIN;
}

export function openingTimeStr(): string {
  return `${String(START_HOUR).padStart(2, '0')}:${String(START_MIN).padStart(2, '0')}`;
}
