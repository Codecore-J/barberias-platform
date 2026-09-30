import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { PagosService } from '../../../core/services/pagos.service';
import { TenantService } from '../../../core/services/tenant.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-tickets',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-4 transform translate-z-12">
        <div>
          <h2 class="text-3xl font-display font-bold text-white">Historial de <span class="gold-gradient-text">Pagos</span></h2>
          <p class="text-sm text-zinc-400">Auditoría inmutable de transacciones en {{ tenantService.nombreBarberiaActiva() }}</p>
        </div>
        <button (click)="cargarTickets()" class="px-5 py-2.5 rounded-xl font-bold text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-2">
          <i class="pi pi-refresh" [class.pi-spin]="pagosService.isLoading()"></i> Refrescar
        </button>
      </div>

      <!-- Estado de Carga -->
      @if (pagosService.isLoading() && pagosService.pagos().length === 0) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Tabla de Tickets -->
      @if (!pagosService.isLoading() || pagosService.pagos().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 relative z-10">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/50">
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Fecha / Hora</th>
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cliente</th>
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Servicios</th>
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Método</th>
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cobrado Por</th>
                  <th class="p-4 text-xs font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (pago of pagosService.pagos(); track pago.id) {
                  <tr class="hover:bg-white/5 transition-colors group">
                    <td class="p-4">
                      <div class="text-sm font-bold text-white">{{ pago.creadoAt | date:'dd MMM yyyy' }}</div>
                      <div class="text-xs text-zinc-500">{{ pago.creadoAt | date:'HH:mm:ss' }}</div>
                    </td>
                    <td class="p-4 text-sm font-medium text-zinc-300">
                      {{ pago.reservaSnapshot?.cliente?.nombre || 'Desconocido' }}
                    </td>
                    <td class="p-4">
                      <div class="flex flex-col gap-1">
                        @for (srv of pago.reservaSnapshot?.detalles || []; track srv.id) {
                          <span class="text-xs text-zinc-400 bg-zinc-800/50 px-2 py-0.5 rounded-full inline-block w-max">
                            {{ srv.nombreServicioHist }} ({{ srv.precioCobradoHist | currency:'USD':'symbol':'1.0-0' }})
                          </span>
                        }
                      </div>
                    </td>
                    <td class="p-4">
                      <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center w-max gap-1">
                        <i [class]="getIconForMethod(pago.metodoPago)"></i> {{ pago.metodoPago }}
                      </span>
                    </td>
                    <td class="p-4 text-sm text-zinc-400">
                      {{ pago.realizadoPor?.nombreCompleto || 'Sistema' }}
                    </td>
                    <td class="p-4 text-right">
                      <span class="text-lg font-bold text-emerald-400">
                        {{ pago.monto | currency:'USD':'symbol':'1.0-0' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (pagosService.pagos().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-receipt text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-400">No se han registrado pagos aún.</p>
            </div>
          }
        </div>
      }

      @if (pagosService.error()) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center animate-shake">
          {{ pagosService.error() }}
        </div>
      }

    </div>
  `,
  styles: [`
    .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
    @keyframes shake {
      10%, 90% { transform: translate3d(-1px, 0, 0); }
      20%, 80% { transform: translate3d(2px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
      40%, 60% { transform: translate3d(3px, 0, 0); }
    }
  `]
})
export class AdminTicketsComponent implements OnInit {
  protected pagosService = inject(PagosService);
  protected tenantService = inject(TenantService);

  ngOnInit() {
    this.cargarTickets();
  }

  cargarTickets() {
    this.pagosService.obtenerHistorial().subscribe();
  }

  getIconForMethod(metodo: string): string {
    switch (metodo?.toUpperCase()) {
      case 'EFECTIVO': return 'pi pi-wallet';
      case 'TARJETA': return 'pi pi-credit-card';
      case 'TRANSFERENCIA': return 'pi pi-mobile';
      default: return 'pi pi-dollar';
    }
  }
}
