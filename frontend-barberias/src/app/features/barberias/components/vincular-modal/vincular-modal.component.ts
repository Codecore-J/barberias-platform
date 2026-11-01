import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../../../core/services/tenant.service';

import { ModalShellComponent } from '../../../../shared/ui/modal-shell/modal-shell.component';

@Component({
  selector: 'app-vincular-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalShellComponent],
  template: `
    <app-modal-shell
      [visible]="true"
      titulo="Vincular Barbería"
      subtitulo="Un código de 8 caracteres te abre la sede"
      icono="pi pi-link"
      [ancho]="'sm'"
      [cerrarBloqueado]="isSubmitting()"
      (cerrar)="close.emit()">

      <p class="text-sm text-zinc-400 text-center">
        Ingresa el código único de 8 caracteres que te proporcionó el administrador.
      </p>

      <input type="text"
             [(ngModel)]="codigo"
             maxlength="8"
             placeholder="ABCDEF12"
             class="w-full text-center tracking-[0.5em] font-mono text-2xl uppercase bg-zinc-950 border-2 border-zinc-700/80 rounded-xl p-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/70 transition-all shadow-inner uppercase-input"
             (input)="formatearCodigo($event)">

      @if (tenantService.error()) {
        <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 animate-shake">
          <i class="pi pi-exclamation-circle mr-1"></i> {{ tenantService.error() }}
        </div>
      }

      <div modal-footer class="pt-2">
        <button (click)="submit()"
                [disabled]="codigo.length !== 8 || isSubmitting()"
                class="w-full py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
          @if (isSubmitting()) {
            <i class="pi pi-spin pi-spinner"></i> Vinculando...
          } @else {
            <i class="pi pi-check"></i> Confirmar Código
          }
        </button>
      </div>
    </app-modal-shell>
  `,
  styles: [`
    .uppercase-input { text-transform: uppercase; }
    .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }

    @keyframes shake {
      10%, 90% { transform: translate3d(-1px, 0, 0); }
      20%, 80% { transform: translate3d(2px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
      40%, 60% { transform: translate3d(3px, 0, 0); }
    }
  `]
})
export class VincularModalComponent {
  @Output() close = new EventEmitter<void>();

  protected tenantService = inject(TenantService);

  codigo = '';
  isSubmitting = signal(false);

  formatearCodigo(event: Event) {
    // Forzar mayúsculas y quitar espacios/caracteres raros si queremos
    const input = event.target as HTMLInputElement;
    this.codigo = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
  }

  submit() {
    if (this.codigo.length !== 8) return;

    this.isSubmitting.set(true);
    this.tenantService.vincularBarberia(this.codigo).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.close.emit();
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }
}
