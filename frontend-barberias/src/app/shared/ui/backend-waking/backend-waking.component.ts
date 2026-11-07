import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EstadoConexionService } from '../../../core/services/estado-conexion.service';

/**
 * Aviso no bloqueante de "el servidor está despertando".
 *
 * El backend vive en el plan gratuito de Render: tras ~15 min sin tráfico la
 * instancia se duerme y la primera petición tarda entre 20 y 50 s. Sin aviso, el
 * usuario ve un panel que "no hace nada" y recarga la página, lo que reinicia la
 * espera. Con aviso, entiende que hay un arranque en curso y que basta esperar.
 *
 * Es `aria-live="polite"` y no un modal: no interrumpe, no tapa la navegación
 * y desaparece solo en cuanto la petición lenta responde.
 */
@Component({
  selector: 'app-backend-waking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (estado.backendDespertando()) {
      <div
        role="status"
        aria-live="polite"
        class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--app-z-toast)] w-[min(92vw,26rem)] pointer-events-none"
      >
        <div
          class="pointer-events-auto flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-zinc-900/95 px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur"
        >
          <i class="pi pi-spin pi-spinner mt-0.5 text-amber-400" aria-hidden="true"></i>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-amber-200">Estamos despertando el servidor</p>
            <p class="mt-0.5 text-xs leading-relaxed text-zinc-400">
              La primera conexión del día puede tardar hasta 30&nbsp;s. No recargues la página:
              sigue en curso.
            </p>
          </div>
          <button
            type="button"
            class="ml-auto shrink-0 rounded-lg px-1.5 text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            aria-label="Ocultar aviso"
            (click)="ocultar()"
          >
            <i class="pi pi-times text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    }
  `,
})
export class BackendWakingComponent {
  protected readonly estado = inject(EstadoConexionService);

  /**
   * El aviso se puede cerrar. `reiniciar()` es lo que lo apaga de verdad: si
   * solo se ocultara la vista, el siguiente `finalize` lo volvería a mostrar a
   * medio camino y el botón parecería no funcionar.
   */
  protected ocultar(): void {
    this.estado.reiniciar();
  }
}
