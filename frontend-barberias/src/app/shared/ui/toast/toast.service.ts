import { Injectable, signal } from '@angular/core';

export type ToastTipo = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  tipo: ToastTipo;
  mensaje: string;
  titulo?: string;
}

/**
 * Tiempo en pantalla por tipo: un error se lee más despacio que una
 * confirmación, y un aviso informativo no necesita quedarse.
 */
const DURACION_MS: Record<ToastTipo, number> = {
  success: 4000,
  info: 4500,
  warning: 6000,
  error: 8000,
};

/** Más de cinco avisos apilados tapan la pantalla sin aportar nada. */
const MAX_VISIBLES = 5;

/**
 * Fase 1 · sistema de notificaciones temporales (toasts).
 *
 * Sustituye a `alert()`: el navegador bloquea el hilo y, sobre todo, rompe la
 * estética Dark Luxury con su diálogo nativo del sistema operativo. Aquí el
 * mensaje se pinta dentro de la app, respeta el tema y desaparece solo.
 *
 * El estado vive en un `signal` porque la app es zoneless: no hay zona que
 * dispare la detección de cambios después de un `setTimeout`, así que el
 * temporizador que descarta el toast tiene que notificar por el propio signal.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private siguienteId = 0;
  private readonly temporizadores = new Map<number, ReturnType<typeof setTimeout>>();

  success(mensaje: string, titulo?: string): void {
    this.mostrar('success', mensaje, titulo);
  }

  error(mensaje: string, titulo?: string): void {
    this.mostrar('error', mensaje, titulo);
  }

  warning(mensaje: string, titulo?: string): void {
    this.mostrar('warning', mensaje, titulo);
  }

  info(mensaje: string, titulo?: string): void {
    this.mostrar('info', mensaje, titulo);
  }

  /** Cierre manual (botón de la X o clic sobre el toast). */
  descartar(id: number): void {
    const temporizador = this.temporizadores.get(id);
    if (temporizador) {
      clearTimeout(temporizador);
      this.temporizadores.delete(id);
    }
    this._toasts.update((lista) => lista.filter((t) => t.id !== id));
  }

  descartarTodos(): void {
    for (const temporizador of this.temporizadores.values()) clearTimeout(temporizador);
    this.temporizadores.clear();
    this._toasts.set([]);
  }

  private mostrar(tipo: ToastTipo, mensaje: string, titulo?: string): void {
    const texto = (mensaje ?? '').trim();
    if (!texto) return;

    const id = ++this.siguienteId;
    this._toasts.update((lista) => [...lista, { id, tipo, mensaje: texto, titulo }]);

    // Al desbordar el tope se retira el más antiguo y se limpia su temporizador:
    // si no, seguiría vivo apuntando a un toast que ya no se pinta.
    if (this._toasts().length > MAX_VISIBLES) {
      const sobrante = this._toasts()[0];
      if (sobrante) this.descartar(sobrante.id);
    }

    this.temporizadores.set(id, setTimeout(() => this.descartar(id), DURACION_MS[tipo]));
  }
}
