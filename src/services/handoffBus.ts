/**
 * handoffBus — ponte de notificação de handoff (bot → atendente humano).
 *
 * Evita import circular: aiAssistService (ferramenta chamar_atendente) não
 * pode importar baileys.ts (que importa o engine, que importa aiAssistService).
 * O canal real registra um notificador aqui na inicialização; a ferramenta
 * só dispara o evento sem conhecer o transporte.
 */

export type HandoffNotifier = (storeId: string, phone: string, motivo: string) => void;

let _notifier: HandoffNotifier | null = null;

export function setHandoffNotifier(fn: HandoffNotifier): void {
  _notifier = fn;
}

export function notifyHandoff(storeId: string, phone: string, motivo: string): void {
  try {
    _notifier?.(storeId, phone, motivo);
  } catch (err) {
    console.error('[handoff] notificador falhou:', (err as Error).message);
  }
}
