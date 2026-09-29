import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../../../core/services/tenant.service';

@Component({
  selector: 'app-vincular-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Overlay/Backdrop -->
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" (click)="close.emit()"></div>

      <!-- Modal Card -->
      <div class="glass-panel relative w-full max-w-md rounded-3xl p-8 shadow-2xl transform-style-3d animate-fade-in-up border border-amber-500/30">
        
        <!-- Glow 3D -->
        <div class="absolute -top-10 -right-10 w-32 h-32 bg-amber-500/20 rounded-full blur-2xl"></div>

        <button (click)="close.emit()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-red-500/80 transition-colors z-10">
          <i class="pi pi-times text-xs"></i>
        </button>

        <div class="space-y-6 relative z-10 text-center pt-2">
          
          <div class="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-3xl shadow-inner transform translate-z-12">
            <i class="pi pi-link"></i>
          </div>

          <div class="space-y-2 transform translate-z-8">
            <h3 class="text-2xl font-display font-bold text-white">Vincular Barbería</h3>
            <p class="text-sm text-zinc-400">
              Ingresa el código único de 8 caracteres que te proporcionó el administrador.
            </p>
          </div>

          <div class="space-y-4 pt-2 transform translate-z-12">
            <div class="relative">
              <input type="text"
                     [(ngModel)]="codigo"
                     maxlength="8"
                     placeholder="ABCDEF12"
                     class="w-full text-center tracking-[0.5em] font-mono text-2xl uppercase bg-zinc-900/80 border-2 border-zinc-700/80 rounded-xl p-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/70 transition-all shadow-inner uppercase-input"
                     (input)="formatearCodigo($event)">
            </div>

            @if (tenantService.error()) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 animate-shake">
                <i class="pi pi-exclamation-circle mr-1"></i> {{ tenantService.error() }}
              </div>
            }

            <button (click)="submit()"
                    [disabled]="codigo.length !== 8 || isSubmitting()"
                    class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
              @if (isSubmitting()) {
                <i class="pi pi-spin pi-spinner"></i> Vinculando...
              } @else {
                <i class="pi pi-check"></i> Confirmar Código
              }
            </button>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: [`
    .uppercase-input { text-transform: uppercase; }
    .animate-fade-in-up { animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
    
    @keyframes fadeInUp {
      0% { opacity: 0; transform: translateY(20px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
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

  formatearCodigo(event: any) {
    // Forzar mayúsculas y quitar espacios/caracteres raros si queremos
    this.codigo = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
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
