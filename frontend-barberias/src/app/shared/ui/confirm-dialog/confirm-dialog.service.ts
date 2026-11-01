import { Injectable, signal } from '@angular/core';

export type TonoDialogo = 'primario' | 'peligro';

/** Configuración del campo de texto opcional (sustituye a `prompt()`). */
export interface EntradaTextoDialogo {
  etiqueta?: string;
  marcador?: string;
  valorInicial?: string;
  multilinea?: boolean;
  /** Si es `true`, no se deja confirmar con el campo vacío. */
  obligatorio?: boolean;
  /** Texto del error cuando falta el valor obligatorio. */
  mensajeObligatorio?: string;
}

export interface ConfirmOptions {
  titulo?: string;
  mensaje: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  tono?: TonoDialogo;
  icono?: string;
  entrada?: EntradaTextoDialogo;
}

/** Estado que consume el componente: ya con todos los valores por defecto aplicados. */
export interface DialogoActivo extends ConfirmOptions {
  modo: 'confirmacion' | 'texto';
  titulo: string;
  textoConfirmar: string;
  textoCancelar: string;
  tono: TonoDialogo;
  icono: string;
}

/**
 * Fase 1 · sistema de diálogos elegantes para sustituir `confirm()` y `prompt()`.
 *
 * El navegador pinta esos diálogos con el tema del sistema operativo: en una app
 * oscura aparecen como una caja blanca que tapa la pantalla, sin estilo, sin
 * contexto de la cita o del servicio sobre el que se pregunta y bloqueando el
 * hilo. Aquí el diálogo vive en la app, así que respeta el Dark Luxury.
 *
 * La API devuelve `Promise` (no `Observable`) a propósito: en los llamantes se
 * lee como una pregunta lineal —`if (!(await confirmar(...))) return;`— y evita
 * anidar la lógica de la acción dentro de un `subscribe`. El componente es
 * único y global, así que nunca se apilan dos diálogos.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly _activo = signal<DialogoActivo | null>(null);
  readonly activo = this._activo.asReadonly();

  private resolver: ((valor: boolean | string | null) => void) | null = null;

  /** Pregunta de sí/no. Resuelve `false` al cancelar, cerrar o pulsar Escape. */
  confirm(opciones: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.abrir('confirmacion', opciones, (valor) => resolve(valor === true));
    });
  }

  /**
   * Pide un texto libre (por ejemplo, el motivo de un rechazo).
   * Resuelve `null` si el usuario cancela, para poder distinguirlo de una
   * cadena vacía sin ambigüedad.
   */
  solicitarTexto(opciones: ConfirmOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.abrir('texto', opciones, (valor) =>
        resolve(typeof valor === 'string' ? valor : null),
      );
    });
  }

  /** Confirmación desde el componente. */
  aceptar(valor?: string): void {
    const activo = this._activo();
    this.cerrar(activo?.modo === 'texto' ? (valor ?? '') : true);
  }

  cancelar(): void {
    this.cerrar(null);
  }

  private cerrar(valor: boolean | string | null): void {
    const resolver = this.resolver;
    this.resolver = null;
    this._activo.set(null);
    resolver?.(valor);
  }

  private abrir(
    modo: DialogoActivo['modo'],
    opciones: ConfirmOptions,
    resolver: (valor: boolean | string | null) => void,
  ): void {
    // Si quedaba una pregunta sin responder (doble clic, navegación a medias),
    // se resuelve como cancelada: dejarla colgada sería un `await` eterno.
    const pendiente = this.resolver;
    this.resolver = null;
    pendiente?.(modo === 'texto' ? null : false);

    const esTexto = modo === 'texto';

    this._activo.set({
      ...opciones,
      modo,
      titulo: opciones.titulo ?? (esTexto ? 'Añadir detalle' : 'Confirmar acción'),
      textoConfirmar: opciones.textoConfirmar ?? (esTexto ? 'Guardar' : 'Confirmar'),
      textoCancelar: opciones.textoCancelar ?? 'Cancelar',
      tono: opciones.tono ?? 'primario',
      icono: opciones.icono ?? (esTexto ? 'pi pi-pencil' : 'pi pi-question-circle'),
    });

    this.resolver = resolver;
  }
}
