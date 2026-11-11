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
 * Fase 2 · ventana de deduplicación.
 *
 * El mismo evento llega por varias suscripciones a la vez —el interceptor de
 * errores, el `catchError` del componente y, en algunos flujos, el servicio de
 * dominio— y cada una pide su toast. Un aviso idéntico repetido dentro de esta
 * ventana es EL MISMO aviso, no otro: se descarta sin apilar un gemelo.
 */
const VENTANA_DEDUPE_MS = 1500;

/** Tope del registro de avisos recientes: solo se guardan los vigentes. */
const MAX_RECIENTES = 50;

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

  /** Fase 2 · último instante en que se mostró cada aviso (clave tipo+título+mensaje). */
  private readonly recientes = new Map<string, number>();

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

    if (this.esDuplicado(tipo, texto, titulo)) return;

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

  /**
   * Fase 2 · filtro de avisos gemelos.
   *
   * Un aviso se considera repetido si ya está EN PANTALLA (misma clave) o si se
   * mostró hace menos de `VENTANA_DEDUPE_MS`. Lo primero cubre las suscripciones
   * simultáneas; lo segundo, la segunda pasada que llega después de que el
   * toast ya se descartó —o de que el `shareReplay` del listado de sedes
   * reemitió y el componente volvió a pintar el mismo error—.
   *
   * No se reutiliza el id del toast visible: repetir el mensaje no reinicia su
   * cuenta atrás, porque el evento ya se anunció.
   */
  private esDuplicado(tipo: ToastTipo, mensaje: string, titulo?: string): boolean {
    const clave = `${tipo}|${titulo ?? ''}|${mensaje}`;
    const ahora = Date.now();

    const visible = this._toasts().some(
      (toast) => `${toast.tipo}|${toast.titulo ?? ''}|${toast.mensaje}` === clave,
    );
    if (visible) return true;

    const ultimo = this.recientes.get(clave);
    if (ultimo !== undefined && ahora - ultimo < VENTANA_DEDUPE_MS) return true;

    // Solo se conservan los avisos que aún están dentro de la ventana: el mapa
    // no puede crecer con cada mensaje distinto que pase por la app.
    for (const [otraClave, instante] of this.recientes) {
      if (ahora - instante >= VENTANA_DEDUPE_MS) this.recientes.delete(otraClave);
    }
    if (this.recientes.size >= MAX_RECIENTES) this.recientes.clear();
    this.recientes.set(clave, ahora);

    return false;
  }
}
