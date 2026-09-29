import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReservasService } from '../../core/services/reservas.service';
import { TenantService } from '../../core/services/tenant.service';
import { CobroModalComponent } from './components/cobro-modal/cobro-modal.component';
import { FichaClienteDrawerComponent } from '../clientes/components/ficha-cliente-drawer/ficha-cliente-drawer.component';

@Component({
  selector: 'app-agenda-barbero',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, CobroModalComponent, FichaClienteDrawerComponent],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header y Filtros -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-6 transform translate-z-12 mb-10">
        <div>
          <h2 class="text-3xl font-display font-bold text-white">Agenda de <span class="gold-gradient-text">Turnos</span></h2>
          <p class="text-sm text-zinc-400">Control de citas para {{ tenantService.nombreBarberiaActiva() }}</p>
        </div>
        
        <div class="glass-panel px-4 py-2 rounded-xl flex items-center gap-3 border border-amber-500/30">
          <i class="pi pi-calendar text-amber-500"></i>
          <input type="date" [(ngModel)]="fechaFiltro" (change)="cargarAgenda()"
                 class="bg-transparent text-white font-bold outline-none border-none cursor-pointer">
        </div>
      </div>

      <!-- Estado de Carga -->
      @if (reservasService.isLoading()) {
        <div class="flex justify-center items-center py-20 transform translate-z-12">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Lista de Turnos -->
      @if (!reservasService.isLoading() && turnos().length > 0) {
        <div class="space-y-4 transform-style-3d">
          @for (turno of turnos(); track turno.id) {
            <div class="glass-card p-6 rounded-2xl border transition-all duration-300 transform-style-3d hover:-translate-y-1 group flex flex-col md:flex-row md:items-center justify-between gap-6"
                 [ngClass]="{
                   'border-amber-500/40 hover:shadow-[0_10px_30px_rgba(212,175,55,0.15)]': turno.estado === 'PENDIENTE',
                   'border-emerald-500/30 opacity-75': turno.estado === 'COMPLETADA',
                   'border-red-500/30 opacity-50': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                 }">
              
              <!-- Info del Cliente y Hora -->
              <div class="flex items-center gap-6 transform translate-z-12">
                <div class="text-center w-20 border-r border-zinc-800 pr-6">
                  <div class="text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">
                    {{ turno.fechaHoraInicio | date:'HH:mm' }}
                  </div>
                  <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border"
                        [ngClass]="{
                          'bg-amber-500/20 text-amber-400 border-amber-500/30': turno.estado === 'PENDIENTE',
                          'bg-emerald-500/20 text-emerald-400 border-emerald-500/30': turno.estado === 'COMPLETADA',
                          'bg-red-500/20 text-red-400 border-red-500/30': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                        }">
                    {{ turno.estado }}
                  </span>
                </div>

                <div>
                  <h3 class="text-lg font-bold text-white flex items-center gap-2">
                    {{ turno.cliente.nombre }}
                    <button (click)="abrirFicha(turno.cliente)" class="text-amber-500 hover:text-amber-400 transition-colors" title="Ver Ficha Técnica">
                      <i class="pi pi-info-circle text-sm"></i>
                    </button>
                    <span class="text-xs font-normal text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full ml-2">{{ turno.cliente.telefono }}</span>
                  </h3>
                  
                  <div class="text-sm text-zinc-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    @for (detalle of turno.detalles; track detalle.id) {
                      <span class="flex items-center gap-1">
                        <i class="pi pi-tag text-[10px] text-amber-500/70"></i>
                        {{ detalle.nombreServicioHist }} ({{ detalle.duracionMinutosHist }}m)
                      </span>
                    }
                  </div>
                </div>
              </div>

              <!-- Precio y Acciones -->
              <div class="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-zinc-800 transform translate-z-12">
                <div class="text-xl font-bold text-white text-right">
                  {{ turno.precioTotalHist | currency:'USD':'symbol':'1.0-0' }}
                </div>

                <!-- Botones de Acción (Solo si está pendiente) -->
                @if (turno.estado === 'PENDIENTE') {
                  <div class="flex items-center gap-2">
                    <button (click)="iniciarCobro(turno)" class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all shadow-lg flex items-center justify-center" title="Cobrar y Completar Cita">
                      <i class="pi pi-dollar"></i>
                    </button>
                    <button (click)="cambiarEstado(turno.id, 'NO_ASISTIO')" class="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-lg flex items-center justify-center" title="Marcar como No Asistió">
                      <i class="pi pi-user-minus"></i>
                    </button>
                  </div>
                } @else {
                  <div class="w-24 text-right">
                    <i class="pi text-xl"
                       [ngClass]="{
                         'pi-check-circle text-emerald-500': turno.estado === 'COMPLETADA',
                         'pi-times-circle text-red-500': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                       }"></i>
                  </div>
                }
              </div>

            </div>
          }
        </div>
      }

      <!-- Empty State -->
      @if (!reservasService.isLoading() && turnos().length === 0) {
        <div class="max-w-md mx-auto text-center py-20 transform translate-z-12">
          <div class="w-24 h-24 mx-auto rounded-full bg-zinc-800/40 border border-zinc-700/50 flex items-center justify-center text-5xl text-zinc-600 mb-6 shadow-inner">
            <i class="pi pi-calendar-times"></i>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Día Libre</h3>
          <p class="text-zinc-400">No hay turnos agendados para este día.</p>
        </div>
      }

      <!-- Modal de Cobro -->
      @if (turnoACobrar()) {
        <app-cobro-modal 
          [turno]="turnoACobrar()" 
          (close)="turnoACobrar.set(null)"
          (cobroExitoso)="onCobroExitoso()">
        </app-cobro-modal>
      }

      <!-- Drawer de Ficha de Cliente -->
      @if (clienteSeleccionado()) {
        <app-ficha-cliente-drawer
          [clienteId]="clienteSeleccionado()!.id"
          [clienteNombre]="clienteSeleccionado()!.nombre"
          (close)="clienteSeleccionado.set(null)">
        </app-ficha-cliente-drawer>
      }

    </div>
  `
})
export class AgendaBarberoComponent implements OnInit {
  protected readonly reservasService = inject(ReservasService);
  protected readonly tenantService = inject(TenantService);

  fechaFiltro: string = new Date().toISOString().split('T')[0];
  turnos = signal<any[]>([]);
  turnoACobrar = signal<any | null>(null);
  clienteSeleccionado = signal<any | null>(null);

  ngOnInit() {
    this.cargarAgenda();
  }

  cargarAgenda() {
    if (!this.fechaFiltro) return;
    this.reservasService.obtenerAgendaDiaria(this.fechaFiltro).subscribe(data => {
      // Ordenar por hora de inicio
      const ordenados = data.sort((a, b) => new Date(a.fechaHoraInicio).getTime() - new Date(b.fechaHoraInicio).getTime());
      this.turnos.set(ordenados);
    });
  }

  cambiarEstado(id: string, nuevoEstado: string) {
    if (confirm(`¿Marcar este turno como ${nuevoEstado}?`)) {
      this.reservasService.cambiarEstado(id, nuevoEstado).subscribe(() => {
        this.cargarAgenda(); // Recargar la vista
      });
    }
  }

  iniciarCobro(turno: any) {
    this.turnoACobrar.set(turno);
  }

  onCobroExitoso() {
    this.turnoACobrar.set(null);
    this.cargarAgenda(); // Recargamos para ver el turno ya completado
  }

  abrirFicha(cliente: any) {
    this.clienteSeleccionado.set(cliente);
  }
}
