import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PagosService } from '../../../core/services/pagos.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';

@Component({
  selector: 'app-admin-tickets',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transform translate-z-12">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-receipt text-xs"></i>
            <span>Auditoría Financiera Inmutable</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">Historial de <span class="gold-gradient-text">Pagos</span></h2>
          <p class="text-sm text-zinc-400">Transacciones y facturación registradas en {{ tenantService.nombreBarberiaActiva() }}</p>
        </div>

        <div class="flex items-center gap-3">
          @if (isAdministradorGlobal()) {
            <button (click)="abrirModalPurga()" 
                    class="px-4 py-2.5 rounded-xl font-semibold text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition-all flex items-center gap-2">
              <i class="pi pi-shield"></i> Purgar Auditoría
            </button>
          }

          <button (click)="cargarTickets()" 
                  class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2">
            <i class="pi pi-refresh" [class.pi-spin]="pagosService.isLoading()"></i> Refrescar
          </button>
        </div>
      </div>

      <!-- FEEDBACK MENSAJES -->
      @if (mensajeExito()) {
        <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2 animate-in fade-in">
          <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
        </div>
      }

      <!-- MÉTRICAS RESUMEN -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 relative z-10">
        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Total Recaudado</p>
            <p class="text-xl sm:text-2xl font-bold text-emerald-400 mt-1">{{ totalRecaudado() | currency:'USD':'symbol':'1.0-0' }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <i class="pi pi-wallet text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Total Pagos</p>
            <p class="text-xl sm:text-2xl font-bold text-white mt-1">{{ totalTickets() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-receipt text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Ticket Promedio</p>
            <p class="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{{ ticketPromedio() | currency:'USD':'symbol':'1.0-0' }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-chart-line text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Efectivo / Tarjeta</p>
            <p class="text-xs font-semibold text-zinc-300 mt-1.5">
              <span class="text-emerald-400">{{ countEfectivo() }}</span> efec · 
              <span class="text-amber-400">{{ countTarjeta() }}</span> tarj
            </p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400">
            <i class="pi pi-credit-card text-lg"></i>
          </div>
        </div>
      </div>

      <!-- FILTROS Y BÚSQUEDA -->
      <div class="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 relative z-10">
        <!-- Filtros por método de pago -->
        <div class="flex items-center gap-2 overflow-x-auto text-xs">
          <span class="text-zinc-500 font-medium mr-1">Método:</span>
          @for (m of ['TODOS', 'EFECTIVO', 'TARJETA', 'TRANSFERENCIA']; track m) {
            <button (click)="filtroMetodo.set(m)"
                    class="px-3 py-1.5 rounded-lg font-medium transition-all"
                    [ngClass]="filtroMetodo() === m 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'">
              {{ m === 'TODOS' ? 'Todos' : m }}
            </button>
          }
        </div>

        <!-- Buscador por texto -->
        <div class="relative w-full sm:w-72">
          <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"></i>
          <input type="text" [(ngModel)]="busquedaTexto" placeholder="Buscar por cliente o servicio..."
                 class="w-full bg-zinc-950/80 border border-zinc-700/60 rounded-xl pl-8 pr-4 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors">
        </div>
      </div>

      <!-- Estado de Carga -->
      @if (pagosService.isLoading() && pagosService.pagos().length === 0) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Tabla de Tickets -->
      @if (!pagosService.isLoading() || pagosFiltrados().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 relative z-10 shadow-xl">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/60">
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Fecha / Hora</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cliente</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Servicios</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Método</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cobrado Por</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (pago of pagosFiltrados(); track pago.id) {
                  <tr class="hover:bg-white/5 transition-colors group">
                    <td class="p-4">
                      <div class="font-bold text-white">{{ pago.creadoAt | date:'dd MMM yyyy' }}</div>
                      <div class="text-[11px] text-zinc-500 font-mono">{{ pago.creadoAt | date:'HH:mm:ss' }}</div>
                    </td>
                    <td class="p-4 font-medium text-zinc-200">
                      {{ pago.reservaSnapshot?.cliente?.nombre || 'Desconocido' }}
                    </td>
                    <td class="p-4">
                      <div class="flex flex-col gap-1">
                        @for (srv of pago.reservaSnapshot?.detalles || []; track srv.id) {
                          <span class="text-[11px] text-zinc-400 bg-zinc-800/60 border border-zinc-700/50 px-2 py-0.5 rounded-full inline-block w-max">
                            {{ srv.nombreServicioHist }} ({{ srv.precioCobradoHist | currency:'USD':'symbol':'1.0-0' }})
                          </span>
                        }
                      </div>
                    </td>
                    <td class="p-4">
                      <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1.5">
                        <i [class]="getIconForMethod(pago.metodoPago)"></i> {{ pago.metodoPago }}
                      </span>
                    </td>
                    <td class="p-4 text-zinc-400">
                      {{ pago.realizadoPor?.nombreCompleto || 'Sistema' }}
                    </td>
                    <td class="p-4 text-right">
                      <span class="text-base font-bold text-emerald-400">
                        {{ pago.monto | currency:'USD':'symbol':'1.0-0' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (pagosFiltrados().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-receipt text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-400 font-medium">No se encontraron pagos con los filtros seleccionados.</p>
              @if (filtroMetodo() !== 'TODOS' || busquedaTexto) {
                <button (click)="resetFiltros()" class="mt-3 text-xs text-amber-400 hover:underline">
                  Limpiar filtros
                </button>
              }
            </div>
          }
        </div>
      }

      @if (pagosService.error()) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center animate-shake">
          {{ pagosService.error() }}
        </div>
      }

      <!-- MODAL PURGA AUDITORÍA (ADMINISTRADOR) -->
      @if (modalPurgaAbierto()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div class="bg-zinc-900 border border-rose-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-6">
              <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <i class="pi pi-shield text-lg"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold text-white">Purga de Auditoría</h3>
                    <p class="text-xs text-zinc-400">Mantenimiento de base de datos (ADMINISTRADOR)</p>
                  </div>
                </div>
                <button (click)="cerrarModalPurga()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-1">
                <p class="font-semibold flex items-center gap-1.5">
                  <i class="pi pi-exclamation-triangle"></i> Operación destructiva irreversible
                </p>
                <p class="text-zinc-400">
                  Esta acción elimina los registros de auditoría más antiguos del plazo especificado para optimizar almacenamiento.
                </p>
              </div>

              <div>
                <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Conservar registros de los últimos:</label>
                <select [(ngModel)]="diasPurga" class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                  <option [ngValue]="180">6 meses (180 días)</option>
                  <option [ngValue]="365">1 año (365 días - Recomendado)</option>
                  <option [ngValue]="730">2 años (730 días)</option>
                </select>
              </div>

              <div class="flex gap-3 pt-4 border-t border-zinc-800">
                <button (click)="cerrarModalPurga()" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="confirmarPurga()" [disabled]="purgando()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30">
                  <i class="pi" [ngClass]="purgando() ? 'pi-spin pi-spinner' : 'pi-trash'"></i>
                  <span>{{ purgando() ? 'Purgando...' : 'Ejecutar Purga' }}</span>
                </button>
              </div>
            </div>
          </div>
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
  protected authService = inject(AuthService);

  filtroMetodo = signal<string>('TODOS');
  busquedaTexto = '';
  modalPurgaAbierto = signal(false);
  purgando = signal(false);
  diasPurga = 365;
  mensajeExito = signal('');

  isAdministradorGlobal = computed(() => {
    const roles = this.authService.authState().user?.roles || [];
    return roles.includes('ADMINISTRADOR');
  });

  // Métricas agregadas
  totalRecaudado = computed(() => {
    return this.pagosService.pagos().reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  });

  totalTickets = computed(() => this.pagosService.pagos().length);

  ticketPromedio = computed(() => {
    const count = this.totalTickets();
    return count > 0 ? this.totalRecaudado() / count : 0;
  });

  countEfectivo = computed(() => {
    return this.pagosService.pagos().filter(p => p.metodoPago?.toUpperCase() === 'EFECTIVO').length;
  });

  countTarjeta = computed(() => {
    return this.pagosService.pagos().filter(p => p.metodoPago?.toUpperCase() === 'TARJETA').length;
  });

  // Lista filtrada
  pagosFiltrados = computed(() => {
    const todos = this.pagosService.pagos();
    const metodo = this.filtroMetodo();
    const query = this.busquedaTexto.toLowerCase().trim();

    return todos.filter(p => {
      // Filtro método
      if (metodo !== 'TODOS' && p.metodoPago?.toUpperCase() !== metodo) {
        return false;
      }
      // Filtro texto
      if (query) {
        const cliente = p.reservaSnapshot?.cliente?.nombre?.toLowerCase() || '';
        const realizadoPor = p.realizadoPor?.nombreCompleto?.toLowerCase() || '';
        const detalles = (p.reservaSnapshot?.detalles || []).map((d: any) => d.nombreServicioHist?.toLowerCase() || '').join(' ');
        if (!cliente.includes(query) && !realizadoPor.includes(query) && !detalles.includes(query)) {
          return false;
        }
      }
      return true;
    });
  });

  ngOnInit() {
    this.cargarTickets();
  }

  cargarTickets() {
    this.pagosService.obtenerHistorial().subscribe();
  }

  resetFiltros() {
    this.filtroMetodo.set('TODOS');
    this.busquedaTexto = '';
  }

  abrirModalPurga() {
    this.modalPurgaAbierto.set(true);
  }

  cerrarModalPurga() {
    this.modalPurgaAbierto.set(false);
  }

  confirmarPurga() {
    this.purgando.set(true);
    this.pagosService.purgarAuditoria(this.diasPurga).subscribe({
      next: (res) => {
        this.purgando.set(false);
        this.cerrarModalPurga();
        this.mensajeExito.set(res?.message || 'Purga de auditoría completada con éxito.');
        setTimeout(() => this.mensajeExito.set(''), 5000);
        this.cargarTickets();
      },
      error: () => {
        this.purgando.set(false);
      }
    });
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
