import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReservasService } from '../../../../core/services/reservas.service';

@Component({
  selector: 'app-cobro-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe],
  template: `
    <!-- Overlay/Backdrop -->
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0">
      <div class="absolute inset-0 bg-black/80 backdrop-blur-md" (click)="cerrar()"></div>

      <!-- Modal Card -->
      <div class="glass-panel relative w-full max-w-lg rounded-3xl p-8 shadow-2xl transform-style-3d animate-fade-in-up border border-emerald-500/30">
        
        <!-- Glow 3D -->
        <div class="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none"></div>

        <!-- Botón de Cerrar -->
        <button (click)="cerrar()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-red-500/80 transition-colors z-10">
          <i class="pi pi-times text-xs"></i>
        </button>

        <div class="space-y-6 relative z-10 pt-2">
          
          <div class="text-center space-y-2 transform translate-z-12">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-3xl shadow-inner mb-4">
              <i class="pi pi-dollar"></i>
            </div>
            <h3 class="text-2xl font-display font-bold text-white">Procesar Cobro</h3>
            <p class="text-sm text-zinc-400">
              Cliente: <span class="text-white font-bold">{{ turno.cliente.nombre }}</span>
            </p>
          </div>

          <!-- Resumen de Monto -->
          <div class="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800 text-center transform translate-z-8 shadow-inner">
            <p class="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Total a Cobrar</p>
            <div class="text-4xl font-display font-extrabold text-emerald-400 drop-shadow-md">
              {{ turno.precioTotalHist | currency:'USD':'symbol':'1.0-0' }}
            </div>
          </div>

          <!-- Métodos de Pago -->
          <div class="space-y-3 transform translate-z-12">
            <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Método de Pago</label>
            <div class="grid grid-cols-3 gap-3">
              <!-- Efectivo -->
              <button (click)="metodoSeleccionado.set('EFECTIVO')"
                      class="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-300 hover:-translate-y-1"
                      [class.border-emerald-500]="metodoSeleccionado() === 'EFECTIVO'"
                      [class.bg-emerald-500/20]="metodoSeleccionado() === 'EFECTIVO'"
                      [class.text-emerald-400]="metodoSeleccionado() === 'EFECTIVO'"
                      [class.border-zinc-700]="metodoSeleccionado() !== 'EFECTIVO'"
                      [class.bg-zinc-800/50]="metodoSeleccionado() !== 'EFECTIVO'"
                      [class.text-zinc-400]="metodoSeleccionado() !== 'EFECTIVO'">
                <i class="pi pi-wallet text-2xl"></i>
                <span class="text-xs font-bold">Efectivo</span>
              </button>

              <!-- Tarjeta -->
              <button (click)="metodoSeleccionado.set('TARJETA')"
                      class="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-300 hover:-translate-y-1"
                      [class.border-emerald-500]="metodoSeleccionado() === 'TARJETA'"
                      [class.bg-emerald-500/20]="metodoSeleccionado() === 'TARJETA'"
                      [class.text-emerald-400]="metodoSeleccionado() === 'TARJETA'"
                      [class.border-zinc-700]="metodoSeleccionado() !== 'TARJETA'"
                      [class.bg-zinc-800/50]="metodoSeleccionado() !== 'TARJETA'"
                      [class.text-zinc-400]="metodoSeleccionado() !== 'TARJETA'">
                <i class="pi pi-credit-card text-2xl"></i>
                <span class="text-xs font-bold">Tarjeta</span>
              </button>

              <!-- Transferencia -->
              <button (click)="metodoSeleccionado.set('TRANSFERENCIA')"
                      class="flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-300 hover:-translate-y-1"
                      [class.border-emerald-500]="metodoSeleccionado() === 'TRANSFERENCIA'"
                      [class.bg-emerald-500/20]="metodoSeleccionado() === 'TRANSFERENCIA'"
                      [class.text-emerald-400]="metodoSeleccionado() === 'TRANSFERENCIA'"
                      [class.border-zinc-700]="metodoSeleccionado() !== 'TRANSFERENCIA'"
                      [class.bg-zinc-800/50]="metodoSeleccionado() !== 'TRANSFERENCIA'"
                      [class.text-zinc-400]="metodoSeleccionado() !== 'TRANSFERENCIA'">
                <i class="pi pi-mobile text-2xl"></i>
                <span class="text-xs font-bold">Transf.</span>
              </button>
            </div>
          </div>

          @if (reservasService.error()) {
            <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 animate-shake">
              <i class="pi pi-exclamation-circle mr-1"></i> {{ reservasService.error() }}
            </div>
          }

          <!-- Botón de Confirmación -->
          <div class="pt-4 transform translate-z-12">
            <button (click)="confirmarCobro()"
                    [disabled]="reservasService.isLoading() || !metodoSeleccionado()"
                    class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2"
                    [ngClass]="metodoSeleccionado() ? 'bg-emerald-500 hover:bg-emerald-400 hover:shadow-[0_15px_30px_rgba(16,185,129,0.4)]' : 'bg-zinc-600'">
              @if (reservasService.isLoading()) {
                <i class="pi pi-spin pi-spinner"></i> Procesando Pago...
              } @else {
                <i class="pi pi-check-circle text-lg"></i> Confirmar y Finalizar Cita
              }
            </button>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: [`
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
export class CobroModalComponent {
  @Input() turno!: any;
  @Output() close = new EventEmitter<void>();
  @Output() cobroExitoso = new EventEmitter<void>();
  
  protected reservasService = inject(ReservasService);
  
  metodoSeleccionado = signal<string | null>(null);

  cerrar() {
    this.close.emit();
  }

  confirmarCobro() {
    if (!this.metodoSeleccionado()) return;
    
    this.reservasService.registrarCobro(this.turno.id, this.metodoSeleccionado()!).subscribe({
      next: () => {
        this.cobroExitoso.emit();
      }
    });
  }
}
