import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmDialogService } from './confirm-dialog.service';
import { ModalOverlayDirective } from '../../directives/modal-overlay.directive';

/**
 * Fase 1 · modal global de confirmación.
 *
 * Se monta una sola vez en `App` y se controla por completo desde
 * `ConfirmDialogService`: los componentes no instancian nada, solo hacen
 * `await confirmar({...})`. Al ser único no hay forma de apilar dos overlays ni
 * de dejar un `appModalOverlay` huérfano que mantenga el documento marcado como
 * `modal-abierto` (eso apagaría el efecto 3D de la página para siempre).
 *
 * Enter confirma y Escape cancela, salvo en un campo multilínea, donde Enter
 * escribe un salto de línea como en cualquier `<textarea>`.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalOverlayDirective],
  styles: [
    `
      @keyframes dialog-in {
        from {
          opacity: 0;
          transform: translate3d(0, 8px, 0) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }
      .dialog-panel {
        animation: dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        .dialog-panel {
          animation: none;
        }
      }
    `,
  ],
  template: `
    @if (dialogo.activo(); as d) {
      <div
        appModalOverlay
        class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        (click)="dialogo.cancelar()"
      >
        <div
          class="dialog-panel w-full max-w-md rounded-3xl border bg-[#171717] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.95)] overflow-hidden"
          [class.border-rose-500/30]="d.tono === 'peligro'"
          [class.border-amber-500/30]="d.tono !== 'peligro'"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          (click)="$event.stopPropagation()"
        >
          <div class="p-6 space-y-5">
            <!-- Cabecera -->
            <div class="flex justify-between items-start gap-4">
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-11 h-11 shrink-0 rounded-xl border flex items-center justify-center"
                  [ngClass]="
                    d.tono === 'peligro'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  "
                >
                  <i class="{{ d.icono }} text-lg"></i>
                </div>
                <div class="min-w-0">
                  <h3 id="confirm-dialog-title" class="text-lg font-bold text-white leading-tight">
                    {{ d.titulo }}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                (click)="dialogo.cancelar()"
                class="text-zinc-500 hover:text-white transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <i class="pi pi-times text-xl"></i>
              </button>
            </div>

            <!-- Mensaje -->
            <p class="text-sm text-zinc-300 leading-relaxed">{{ d.mensaje }}</p>

            <!-- Campo de texto (ex prompt) -->
            @if (d.entrada; as entrada) {
              <div class="space-y-1.5">
                @if (entrada.etiqueta) {
                  <label
                    for="confirm-dialog-input"
                    class="block text-[11px] font-bold uppercase tracking-wider text-zinc-400"
                  >
                    {{ entrada.etiqueta }}
                  </label>
                }

                @if (entrada.multilinea) {
                  <textarea
                    id="confirm-dialog-input"
                    #campo
                    rows="3"
                    [(ngModel)]="valor"
                    [placeholder]="entrada.marcador || ''"
                    [class.border-rose-500/60]="error()"
                    class="w-full rounded-xl bg-black/50 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 transition-all resize-none"
                  ></textarea>
                } @else {
                  <input
                    id="confirm-dialog-input"
                    #campo
                    type="text"
                    [(ngModel)]="valor"
                    [placeholder]="entrada.marcador || ''"
                    [class.border-rose-500/60]="error()"
                    class="w-full rounded-xl bg-black/50 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 transition-all"
                  />
                }

                @if (error(); as textoError) {
                  <p class="text-xs text-rose-400 flex items-center gap-1.5">
                    <i class="pi pi-exclamation-circle text-[11px]"></i>{{ textoError }}
                  </p>
                }
              </div>
            }

            <!-- Acciones -->
            <div class="flex flex-col-reverse sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                (click)="dialogo.cancelar()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-zinc-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
              >
                {{ d.textoCancelar }}
              </button>
              <button
                type="button"
                (click)="confirmar()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                [ngClass]="
                  d.tono === 'peligro'
                    ? 'text-white bg-rose-600 hover:bg-rose-500 shadow-[0_4px_16px_rgba(225,29,72,0.28)]'
                    : 'text-zinc-950 gold-gradient-bg hover:brightness-110 shadow-[0_4px_16px_rgba(212,175,55,0.25)]'
                "
              >
                {{ d.textoConfirmar }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly dialogo = inject(ConfirmDialogService);

  /** Valor del campo de texto; se reinicia cada vez que cambia el diálogo. */
  protected readonly valor = signal('');
  protected readonly error = signal<string | null>(null);

  private readonly campo = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('campo');

  constructor() {
    // Al abrirse un campo de texto se parte del valor inicial y se enfoca: sin
    // el foco, el usuario tendría que hacer clic en una caja que acaba de
    // aparecer, justo lo que `prompt()` resolvía por él.
    effect(() => {
      const activo = this.dialogo.activo();
      this.valor.set(activo?.entrada?.valorInicial ?? '');
      this.error.set(null);

      const elemento = this.campo()?.nativeElement;
      if (activo?.modo === 'texto' && elemento) elemento.focus();
    });

    const onKeydown = (evento: KeyboardEvent) => {
      const activo = this.dialogo.activo();
      if (!activo) return;

      if (evento.key === 'Escape') {
        evento.preventDefault();
        this.dialogo.cancelar();
        return;
      }

      // Enter confirma salvo en un `textarea`, donde debe seguir insertando un
      // salto de línea. Si el foco está en un botón, su propio clic ya actúa:
      // interceptarlo aquí dispararía la acción dos veces.
      const esBoton = (evento.target as HTMLElement | null)?.tagName === 'BUTTON';
      const multilinea = activo.entrada?.multilinea === true;
      if (evento.key === 'Enter' && !multilinea && !esBoton) {
        evento.preventDefault();
        this.confirmar();
      }
    };

    document.addEventListener('keydown', onKeydown);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', onKeydown));
  }

  protected confirmar(): void {
    const activo = this.dialogo.activo();
    if (!activo) return;

    if (activo.modo === 'texto') {
      const texto = this.valor().trim();
      if (activo.entrada?.obligatorio && !texto) {
        this.error.set(
          activo.entrada.mensajeObligatorio ?? 'Este campo es obligatorio para continuar.',
        );
        return;
      }
      this.dialogo.aceptar(texto);
      return;
    }

    this.dialogo.aceptar();
  }
}
