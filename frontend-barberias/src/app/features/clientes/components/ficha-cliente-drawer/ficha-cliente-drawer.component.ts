import { Component, EventEmitter, Input, Output, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientesService, FichaCliente } from '../../../../core/services/clientes.service';

@Component({
  selector: 'app-ficha-cliente-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <!-- Overlay/Backdrop -->
    <div class="fixed inset-0 z-[100] flex justify-end">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" (click)="cerrar()"></div>

      <!-- Drawer Content -->
      <div class="relative w-full max-w-md h-full bg-obsidian border-l border-amber-500/30 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] flex flex-col animate-slide-in-right">
        
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-zinc-800 bg-zinc-900/50">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 text-xl font-bold">
              {{ clienteNombre.charAt(0) | uppercase }}
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">{{ clienteNombre }}</h2>
              <p class="text-xs text-zinc-400">Ficha Técnica Privada</p>
            </div>
          </div>
          <button (click)="cerrar()" class="w-8 h-8 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors flex items-center justify-center">
            <i class="pi pi-times"></i>
          </button>
        </div>

        @if (clientesService.isLoading()) {
          <div class="flex-grow flex justify-center items-center">
            <i class="pi pi-spin pi-spinner text-3xl text-amber-500"></i>
          </div>
        } @else if (ficha()) {
          <!-- Scrollable Content -->
          <div class="flex-grow overflow-y-auto p-6 space-y-8">
            
            <!-- Estadísticas Rápidas -->
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 text-center">
                <p class="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Citas Completadas</p>
                <p class="text-2xl font-bold text-emerald-400">{{ ficha()!.totalCitas }}</p>
              </div>
              <div class="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 text-center">
                <p class="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Inasistencias</p>
                <p class="text-2xl font-bold" [ngClass]="ficha()!.totalCanceladas > 0 ? 'text-red-400' : 'text-zinc-400'">
                  {{ ficha()!.totalCanceladas }}
                </p>
              </div>
            </div>

            <!-- Listado de Notas -->
            <div class="space-y-4">
              <h3 class="text-sm font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                <i class="pi pi-book"></i> Anotaciones del Barbero
              </h3>
              
              <div class="space-y-3">
                @for (nota of ficha()!.notas; track nota.id) {
                  <div class="bg-zinc-800/40 p-4 rounded-xl border border-zinc-700/50 text-sm text-zinc-300">
                    <p>{{ nota.contenido }}</p>
                    <p class="text-[10px] text-zinc-500 mt-2 text-right">{{ nota.fechaCreacion | date:'dd MMM yyyy, HH:mm' }}</p>
                  </div>
                }
                
                @if (ficha()!.notas.length === 0) {
                  <p class="text-sm text-zinc-500 italic text-center py-4">No hay notas registradas para este cliente.</p>
                }
              </div>
            </div>
          </div>

          <!-- Input Area (Footer) -->
          <div class="p-6 border-t border-zinc-800 bg-zinc-900/50">
            <label class="text-xs font-bold text-zinc-400 mb-2 block">Agregar nueva nota (Ej. Corte preferido, alergias)</label>
            <div class="relative">
              <textarea [(ngModel)]="nuevaNota" rows="3"
                        class="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 pr-12 text-sm text-white placeholder-zinc-600 focus:border-amber-500 outline-none resize-none"
                        placeholder="Escribe aquí..."></textarea>
              <button (click)="guardarNota()" [disabled]="!nuevaNota.trim() || isSubmitting()"
                      class="absolute bottom-3 right-3 w-8 h-8 rounded-lg bg-amber-500 text-zinc-950 flex items-center justify-center disabled:opacity-50 hover:bg-amber-400 transition-colors">
                <i class="pi" [ngClass]="isSubmitting() ? 'pi-spin pi-spinner' : 'pi-send'"></i>
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .animate-slide-in-right { animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes slideInRight {
      0% { transform: translateX(100%); }
      100% { transform: translateX(0); }
    }
  `]
})
export class FichaClienteDrawerComponent implements OnInit {
  @Input() clienteId!: string;
  @Input() clienteNombre!: string;
  @Output() close = new EventEmitter<void>();

  protected clientesService = inject(ClientesService);
  
  ficha = signal<FichaCliente | null>(null);
  nuevaNota: string = '';
  isSubmitting = signal(false);

  ngOnInit() {
    this.cargarFicha();
  }

  cargarFicha() {
    this.clientesService.obtenerFichaCliente(this.clienteId).subscribe(data => {
      this.ficha.set(data);
    });
  }

  cerrar() {
    this.close.emit();
  }

  guardarNota() {
    if (!this.nuevaNota.trim()) return;
    
    this.isSubmitting.set(true);
    this.clientesService.guardarNota(this.clienteId, this.nuevaNota.trim()).subscribe({
      next: (nota) => {
        // Actualizamos la lista localmente
        const currentFicha = this.ficha();
        if (currentFicha) {
          currentFicha.notas.unshift(nota);
          this.ficha.set({...currentFicha});
        }
        this.nuevaNota = '';
        this.isSubmitting.set(false);
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }
}
