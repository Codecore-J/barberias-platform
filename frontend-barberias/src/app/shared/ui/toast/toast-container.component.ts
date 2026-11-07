import { Component, inject } from '@angular/core';
import { ToastService, ToastTipo } from './toast.service';

interface EstiloToast {
  icono: string;
  acento: string;
  borde: string;
  titulo: string;
}

const ESTILOS: Record<ToastTipo, EstiloToast> = {
  success: {
    icono: 'pi pi-check-circle',
    acento: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    borde: 'border-l-emerald-500/70',
    titulo: 'text-emerald-300',
  },
  error: {
    icono: 'pi pi-times-circle',
    acento: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    borde: 'border-l-rose-500/70',
    titulo: 'text-rose-300',
  },
  warning: {
    icono: 'pi pi-exclamation-triangle',
    acento: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    borde: 'border-l-amber-500/70',
    titulo: 'text-amber-300',
  },
  info: {
    icono: 'pi pi-info-circle',
    acento: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
    borde: 'border-l-sky-500/70',
    titulo: 'text-sky-300',
  },
};

/**
 * Fase 1 · contenedor global de toasts.
 *
 * Se monta una sola vez en `App`, fuera del `router-outlet`, para que el aviso
 * sobreviva a la navegación: un error de red que ocurre justo cuando el usuario
 * cambia de pantalla no debe perderse con el componente que lo provocó.
 *
 * Va abajo a la derecha y en `column-reverse`: los avisos nuevos entran por el
 * borde inferior sin empujar hacia arriba a los que ya se están leyendo, y no
 * tapa las cabeceras ni los botones de acción de las páginas.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  styles: [
    `
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translate3d(0, 12px, 0) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }
      .toast-item {
        animation: toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        .toast-item {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div
      class="toast-layer fixed bottom-6 right-4 left-4 sm:left-auto sm:right-6 flex flex-col-reverse gap-2.5 sm:w-[22rem] pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      @for (toast of toastService.toasts(); track toast.id) {
        @let estilo = estiloDe(toast.tipo);
        <div
          class="toast-item pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/10 border-l-4 {{ estilo.borde }}
                 bg-[#171717]/95 backdrop-blur-md px-4 py-3 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]"
          [attr.role]="toast.tipo === 'error' ? 'alert' : 'status'"
        >
          <span
            class="mt-0.5 w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center {{ estilo.acento }}"
          >
            <i class="{{ estilo.icono }} text-[13px]"></i>
          </span>

          <div class="min-w-0 flex-1">
            @if (toast.titulo) {
              <p class="text-[13px] font-bold leading-tight {{ estilo.titulo }}">{{ toast.titulo }}</p>
            }
            <p class="text-[13px] leading-snug {{ toast.titulo ? 'text-zinc-300' : 'text-zinc-100' }}">
              {{ toast.mensaje }}
            </p>
          </div>

          <button
            type="button"
            (click)="toastService.descartar(toast.id)"
            class="shrink-0 text-zinc-500 hover:text-white transition-colors mt-0.5"
            aria-label="Cerrar notificación"
          >
            <i class="pi pi-times text-[11px]"></i>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  protected estiloDe(tipo: ToastTipo): EstiloToast {
    return ESTILOS[tipo];
  }
}
