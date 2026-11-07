import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalOverlayDirective } from '../../directives/modal-overlay.directive';

export type AnchoModal = 'sm' | 'md' | 'lg' | 'xl';
export type TonoModal = 'primario' | 'peligro';

/** 400px para preguntas cortas, 800px para formularios con resumen. */
const ANCHOS: Record<AnchoModal, number> = {
  sm: 400,
  md: 448,
  lg: 640,
  xl: 800,
};

/** Controles que participan en el recorrido del foco. */
const SELECTOR_ENFOCABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let contadorInstancias = 0;

/**
 * Fase 2 · envoltorio único de modales.
 *
 * Antes cada modal repetía a mano el mismo bloque: overlay `fixed inset-0`, el
 * panel centrado, el backdrop con blur, la cabecera con icono y botón de cierre.
 * Además cada uno resolvía la accesibilidad a su manera (la mayoría, ninguna):
 * sin `role="dialog"`, sin `aria-modal`, sin devolver el foco al cerrar y sin
 * trampa de tabulación — con el modal abierto, `Tab` se escapaba a la página de
 * fondo y el lector de pantalla no anunciaba que había un diálogo encima.
 *
 * El shell concentra esas cuatro cosas y el cuerpo se proyecta con
 * `<ng-content>`:
 *
 *   ┌ overlay + backdrop + centrado
 *   ├ cabecera (título, subtítulo, icono, X)
 *   ├ cuerpo  ← contenido por defecto
 *   └ pie     ← cualquier nodo marcado con el atributo `modal-footer`
 *
 * El `modal-abierto` lo gestiona `ModalOverlayDirective` (no un contador
 * propio) a propósito: esa directiva cuenta los overlays abiertos en una
 * variable estática y los modales que aún no se han migrado siguen usándola. Un
 * segundo contador independiente se pisaría con ella y quitaría la clase —y con
 * ella el arreglo de `perspective` de H-03— mientras el otro modal sigue en
 * pantalla. La clase se pone en `<html>` porque es lo que selecciona
 * `styles.css`; ahí mismo se cuelga el bloqueo de scroll.
 */
@Component({
  selector: 'app-modal-shell',
  standalone: true,
  imports: [CommonModule, ModalOverlayDirective],
  styles: [
    `
      @keyframes shell-in {
        from {
          opacity: 0;
          transform: translate3d(0, 8px, 0) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }
      .modal-shell-panel {
        animation: shell-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .modal-shell-panel:focus {
        outline: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .modal-shell-panel {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div
      #overlay
      [appModalOverlay]="visible()"
      [style.display]="visible() ? 'flex' : 'none'"
      class="modal-shell-overlay fixed inset-0 items-center justify-center p-4 bg-black/70 backdrop-blur-md overflow-y-auto"
      (click)="alClicEnFondo()"
    >
        <div
          #panel
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="idTitulo"
          tabindex="-1"
          class="modal-shell-panel w-full my-auto rounded-3xl border bg-zinc-900 shadow-2xl overflow-hidden"
          [class.border-rose-500/30]="tono() === 'peligro'"
          [class.border-amber-500/30]="tono() !== 'peligro'"
          [style.max-width.px]="anchoPx()"
          (click)="$event.stopPropagation()"
        >
          <div class="p-6 space-y-5">
            <!-- Cabecera -->
            <div class="flex justify-between items-start gap-4">
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center"
                  [ngClass]="
                    tono() === 'peligro'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  "
                >
                  <i class="{{ icono() }} text-lg"></i>
                </div>
                <div class="min-w-0">
                  <h3 [id]="idTitulo" class="text-lg font-bold text-white leading-tight">
                    {{ titulo() }}
                  </h3>
                  @if (subtitulo(); as sub) {
                    <p class="text-xs text-zinc-400">{{ sub }}</p>
                  }
                </div>
              </div>

              <button
                type="button"
                (click)="solicitarCierre()"
                [disabled]="cerrarBloqueado()"
                class="modal-shell-cerrar text-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <i class="pi pi-times text-xl"></i>
              </button>
            </div>

            <!-- Cuerpo -->
            <ng-content />

            <!-- Pie (opcional): cualquier nodo con el atributo modal-footer -->
            <ng-content select="[modal-footer]" />
          </div>
        </div>
    </div>
  `,
})
export class ModalShellComponent {
  readonly visible = input(false);
  readonly titulo = input('');
  readonly subtitulo = input<string | null>(null);
  readonly icono = input('pi pi-info-circle');
  readonly tono = input<TonoModal>('primario');
  readonly ancho = input<AnchoModal>('md');
  /** Mientras una operación está en vuelo no se deja cerrar el modal. */
  readonly cerrarBloqueado = input(false);

  readonly cerrar = output<void>();

  protected readonly idTitulo = `modal-shell-titulo-${++contadorInstancias}`;
  protected readonly anchoPx = signal(ANCHOS.md);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly overlay = viewChild<ElementRef<HTMLElement>>('overlay');

  /** Elemento que tenía el foco antes de abrir: se le devuelve al cerrar. */
  private ultimoFoco: HTMLElement | null = null;
  private estabaAbierto = false;

  constructor() {
    // Se ejecuta tras el primer render: en ese momento el overlay ya está en el
    // DOM y `viewChild` lo resuelve.
    afterNextRender(() => this.portarOverlay());

    effect(() => {
      const abierto = this.visible();
      this.anchoPx.set(ANCHOS[this.ancho()]);

      // Solo se reacciona al cambio de visibilidad: si no, ajustar el ancho con
      // el modal ya abierto volvería a capturar `ultimoFoco` (que a esas alturas
      // es un control de dentro del propio modal) y el foco no volvería al
      // botón que lo abrió.
      if (abierto === this.estabaAbierto) return;
      this.estabaAbierto = abierto;

      if (abierto) {
        this.ultimoFoco = document.activeElement as HTMLElement | null;
        // El contenido proyectado no está en el DOM hasta que Angular termina
        // de pintar; por eso el foco se pide en el siguiente turno del bucle.
        setTimeout(() => this.enfocarPrimero(), 0);
      } else {
        this.restaurarFoco();
      }
    });

    // Muchos modales los monta el padre con `@if`: al cerrar, el componente se
    // destruye sin que `visible` llegue a pasar por `false`. Sin este gancho el
    // foco se quedaría en el `<body>` y con el teclado habría que empezar a
    // tabular desde el principio de la página.
    inject(DestroyRef).onDestroy(() => {
      this.restaurarFoco();
      // El overlay vive fuera del host (ver `portarOverlay`): si no se retira a
      // mano, quedarse en `<body>` sería una fuga al cambiar de ruta.
      this.overlay()?.nativeElement.remove();
    });
  }

  /**
   * H-01 · saca el overlay del árbol de la página para que su `z-index` no
   * quede encerrado en un contexto de apilamiento ajeno.
   *
   * El overlay se monta dentro de `<main class="relative z-10">`, y además cada
   * vista suele envolver su contenido en otro `relative z-10` (más
   * `animate-fade-in`, que también abre contexto mientras anima). Un
   * `position: fixed` NO escapa de eso: su `z-index` solo compite dentro de ese
   * contexto y el `<header>` y el `<footer>`, que son hermanos de `<main>`, se
   * pintan por encima. El resultado era un modal visible cuyos botones no
   * recibían el clic: el `elementFromPoint` devolvía el pie de página.
   *
   * Se mueve el nodo a `<body>`, el mismo nivel que ya usaban el toast y el
   * diálogo de confirmación, y la escala de `styles.css` lo coloca en 1100:
   * por encima de la cabecera y del pie, por debajo de notificaciones y
   * confirmaciones.
   *
   * El elemento se monta siempre (y se oculta con `display: none`) precisamente
   * para poder moverlo sin que Angular intente retirarlo después de un padre
   * equivocado: con un `@if` alrededor, el `removeChild` del cierre lanzaría
   * `NotFoundError` porque el nodo ya no cuelga del host.
   */
  private portarOverlay(): void {
    const overlay = this.overlay()?.nativeElement;
    if (!overlay || overlay.parentNode === document.body) return;
    document.body.appendChild(overlay);
  }

  protected solicitarCierre(): void {
    if (this.cerrarBloqueado()) return;
    this.cerrar.emit();
  }

  /** Un clic en el backdrop cierra; el panel detiene la propagación. */
  protected alClicEnFondo(): void {
    this.solicitarCierre();
  }

  @HostListener('window:keydown.escape', ['$event'])
  protected alPulsarEscape(bruto: Event): void {
    // Con un alias de tecla (`keydown.escape`) Angular tipa `$event` como `Event`
    // genérico, no como `KeyboardEvent`.
    const evento = bruto as KeyboardEvent;
    if (!this.visible() || this.cerrarBloqueado()) return;
    evento.preventDefault();
    evento.stopPropagation();
    this.cerrar.emit();
  }

  /**
   * Trampa de tabulación: sin esto, `Tab` desde el último control salta a la
   * barra de navegación de detrás del modal y el usuario termina interactuando
   * con una pantalla que cree bloqueada.
   */
  @HostListener('window:keydown.tab', ['$event'])
  protected alPulsarTab(bruto: Event): void {
    const evento = bruto as KeyboardEvent;
    if (!this.visible()) return;

    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = this.elementosEnfocables(panel);
    const activo = document.activeElement as HTMLElement | null;

    if (enfocables.length === 0) {
      evento.preventDefault();
      panel.focus();
      return;
    }

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const fueraDelPanel = !activo || !panel.contains(activo);

    if (evento.shiftKey && (activo === primero || fueraDelPanel)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (activo === ultimo || fueraDelPanel)) {
      evento.preventDefault();
      primero.focus();
    }
  }

  private enfocarPrimero(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    // Se salta la X de la cabecera: es el primer enfocable del panel, pero
    // dejar ahí el foco obliga a un `Tab` de más para llegar al formulario. Si
    // el cuerpo no tiene controles (confirmaciones), cae de vuelta al botón de
    // cancelar del pie, que es la opción segura por defecto.
    const candidatos = this.elementosEnfocables(panel).filter(
      (el) => !el.classList.contains('modal-shell-cerrar'),
    );
    (candidatos[0] ?? panel).focus();
  }

  private restaurarFoco(): void {
    const anterior = this.ultimoFoco;
    this.ultimoFoco = null;
    // El elemento puede haberse desmontado (la tabla se recargó tras confirmar).
    if (anterior && document.body.contains(anterior)) anterior.focus();
  }

  private elementosEnfocables(panel: HTMLElement): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)).filter(
      (el) => el.tabIndex !== -1 && (el.offsetWidth > 0 || el.offsetHeight > 0),
    );
  }
}
