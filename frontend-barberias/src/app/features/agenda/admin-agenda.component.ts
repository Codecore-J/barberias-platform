import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReservasService } from '../../core/services/reservas.service';
import { PersonalService, Personal } from '../../core/services/personal.service';
import { TenantService } from '../../core/services/tenant.service';
import { CobroModalComponent } from './components/cobro-modal/cobro-modal.component';
import { FichaClienteDrawerComponent } from '../clientes/components/ficha-cliente-drawer/ficha-cliente-drawer.component';
import { WalkInModalComponent } from './components/walk-in-modal/walk-in-modal.component';

@Component({
  selector: 'app-admin-agenda',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, CobroModalComponent, FichaClienteDrawerComponent, WalkInModalComponent],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-[1400px] mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header y Filtros -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-6 mb-10 relative z-20">
        <div>
          <h2 class="text-3xl font-display font-bold text-white">Consola de <span class="text-amber-400">Agenda</span></h2>
          <p class="text-sm text-zinc-400">Modo Administrador - Vista de todas las columnas ({{ tenantService.nombreBarberiaActiva() }})</p>
        </div>
        
        <div class="flex gap-4">
          <button (click)="mostrarModalWalkIn.set(true)" class="glass-panel px-4 py-2 rounded-xl flex items-center gap-2 border border-emerald-500/50 hover:bg-emerald-500/10 transition-colors text-emerald-400 font-bold text-sm shadow-lg">
            <i class="pi pi-user-plus"></i> Walk-In
          </button>
          
          <div class="glass-panel px-4 py-2 rounded-xl flex items-center gap-3 border border-amber-500/30">
            <i class="pi pi-calendar text-amber-500"></i>
            <input type="date" [(ngModel)]="fechaFiltro" (change)="cargarDatos()"
                   class="bg-transparent text-white font-bold outline-none border-none cursor-pointer">
          </div>
        </div>
      </div>

      <!-- Estado de Carga -->
      @if (cargando()) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Consola Multi-Columna (Modo Dios) -->
      @if (!cargando()) {
        <div class="flex overflow-x-auto gap-6 hide-scrollbar pb-6 relative z-10">
          
          <!-- Columna por cada Barbero -->
          @for (barbero of barberos(); track barbero.id) {
            <div class="min-w-[340px] flex-1 glass-panel rounded-3xl border border-white/5 p-5 flex flex-col max-h-[75vh]">
              <!-- Cabecera del Barbero -->
              <div class="text-center pb-5 border-b border-white/5 mb-5 shrink-0">
                <div class="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center text-xl font-bold text-amber-400 shadow-lg mb-3">
                  {{ barbero.nombreCompleto.charAt(0).toUpperCase() }}
                </div>
                <h3 class="text-white font-bold text-lg leading-tight">{{ barbero.nombreCompleto }}</h3>
                <span class="text-xs text-amber-500/80 font-medium">
                  {{ turnosPorBarbero(barbero.id).length }} turnos agendados
                </span>
              </div>
              
              <!-- Contenedor scrolleable de Turnos -->
              <div class="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                @for (turno of turnosPorBarbero(barbero.id); track turno.id) {
                  <div class="bg-zinc-900/80 p-4 rounded-2xl border-l-4 transition-all hover:bg-zinc-800/80 cursor-pointer shadow-md flex flex-col gap-2 relative overflow-hidden"
                       [ngClass]="{
                         'border-amber-500': turno.estado === 'PENDIENTE' && (!turno.cliente?.contadorNoPresentado || turno.cliente.contadorNoPresentado < 3),
                         'border-red-500 bg-red-950/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]': turno.estado === 'PENDIENTE' && turno.cliente?.contadorNoPresentado >= 3,
                         'border-emerald-500 opacity-60': turno.estado === 'COMPLETADA',
                         'border-red-500 opacity-50': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                       }">
                    
                    <div class="flex justify-between items-start">
                      <div class="flex items-center gap-2">
                        <span class="text-lg font-bold text-white tracking-tight">{{ turno.fechaHoraInicio | date:'HH:mm' }}</span>
                        <span class="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-zinc-800"
                              [ngClass]="{
                                'text-amber-400': turno.estado === 'PENDIENTE',
                                'text-emerald-400': turno.estado === 'COMPLETADA',
                                'text-red-400': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                              }">
                          {{ turno.estado }}
                        </span>
                      </div>
                      <div class="text-sm font-bold text-emerald-400">
                        {{ turno.precioTotalHist | currency:'USD':'symbol':'1.0-0' }}
                      </div>
                    </div>

                    <div>
                      <div class="text-sm text-zinc-300 font-medium flex items-center justify-between relative z-10">
                        <div class="flex items-center gap-2">
                          {{ turno.cliente.nombre }}
                          @if (turno.cliente?.contadorNoPresentado >= 3) {
                            <i class="pi pi-exclamation-triangle text-red-500 animate-pulse" 
                               [title]="'Advertencia: Cliente con ' + turno.cliente.contadorNoPresentado + ' inasistencias previas'"></i>
                          }
                          @if (turno.cliente?.estaRestringido) {
                            <span class="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Bloqueado</span>
                          }
                        </div>
                        <button (click)="abrirFicha(turno.cliente)" class="text-amber-500 hover:text-amber-400 transition-colors" title="Ficha del Cliente">
                          <i class="pi pi-id-card text-lg"></i>
                        </button>
                      </div>
                      <div class="text-xs text-zinc-500 mt-1 flex flex-col gap-1">
                        @for (detalle of turno.detalles; track detalle.id) {
                          <span class="flex items-center gap-1">
                            <i class="pi pi-circle-fill text-[6px] text-amber-500/50"></i>
                            {{ detalle.nombreServicioHist }} ({{ detalle.duracionMinutosHist }}m)
                          </span>
                        }
                      </div>
                    </div>

                    <!-- Acciones Rápidas del Turno -->
                    @if (turno.estado === 'PENDIENTE') {
                      <div class="flex items-center justify-end gap-2 pt-2 mt-2 border-t border-white/5">
                         <button (click)="iniciarCobro(turno)" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                           Cobrar
                         </button>
                         <button (click)="cambiarEstado(turno.id, 'NO_ASISTIO')" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                           No Asistió
                         </button>
                      </div>
                    }
                  </div>
                } @empty {
                  <div class="text-center py-10 border border-dashed border-white/10 rounded-2xl">
                    <i class="pi pi-inbox text-2xl text-zinc-600 mb-2"></i>
                    <p class="text-zinc-500 text-sm">No hay citas registradas</p>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Columna para Turnos Sin Asignar (Opcional, si existen en el backend) -->
          @if (turnosSinAsignar().length > 0) {
            <div class="min-w-[340px] flex-1 glass-panel rounded-3xl border border-white/5 p-5 flex flex-col max-h-[75vh] opacity-80">
              <div class="text-center pb-5 border-b border-white/5 mb-5 shrink-0">
                <div class="w-16 h-16 mx-auto rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl font-bold text-zinc-400 shadow-lg mb-3">
                  ?
                </div>
                <h3 class="text-white font-bold text-lg leading-tight">Sin Asignar</h3>
                <span class="text-xs text-zinc-400 font-medium">{{ turnosSinAsignar().length }} turnos</span>
              </div>
              
              <div class="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                @for (turno of turnosSinAsignar(); track turno.id) {
                  <!-- Igual que arriba -->
                  <div class="bg-zinc-900/80 p-4 rounded-2xl border-l-4 border-zinc-500 flex flex-col gap-2">
                    <div class="flex justify-between items-start">
                      <span class="text-lg font-bold text-white tracking-tight">{{ turno.fechaHoraInicio | date:'HH:mm' }}</span>
                      <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">PENDIENTE</span>
                    </div>
                    <div class="text-sm text-zinc-300 font-medium">{{ turno.cliente.nombre }}</div>
                  </div>
                }
              </div>
            </div>
          }

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

      <!-- Modal Walk-In -->
      @if (mostrarModalWalkIn()) {
        <app-walk-in-modal
          [fecha]="fechaFiltro"
          [barberos]="barberos()"
          (close)="mostrarModalWalkIn.set(false)"
          (creado)="onWalkInCreado()">
        </app-walk-in-modal>
      }

    </div>
  `
})
export class AdminAgendaComponent implements OnInit {
  protected readonly reservasService = inject(ReservasService);
  protected readonly personalService = inject(PersonalService);
  protected readonly tenantService = inject(TenantService);

  fechaFiltro: string = new Date().toISOString().split('T')[0];
  
  turnos = signal<any[]>([]);
  barberos = signal<Personal[]>([]);
  cargando = signal(true);
  mostrarModalWalkIn = signal(false);

  turnoACobrar = signal<any | null>(null);
  clienteSeleccionado = signal<any | null>(null);

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia || !this.fechaFiltro) return;

    this.cargando.set(true);

    // Cargar personal y agenda simultáneamente
    this.personalService.obtenerPersonal(barberia.id).subscribe({
      next: (personal) => {
        // Filtrar solo los que tienen rol BARBERO (o mostrarlos todos)
        const soloBarberos = personal.filter(p => p.roles.includes('BARBERO'));
        this.barberos.set(soloBarberos.length > 0 ? soloBarberos : personal);
        
        this.reservasService.obtenerAgendaDiaria(this.fechaFiltro).subscribe({
          next: (turnos) => {
            this.turnos.set(turnos);
            this.cargando.set(false);
          },
          error: () => this.cargando.set(false)
        });
      },
      error: () => this.cargando.set(false)
    });
  }

  turnosPorBarbero(barberoId: string) {
    return this.turnos()
      .filter(t => t.barbero?.id === barberoId)
      .sort((a, b) => new Date(a.fechaHoraInicio).getTime() - new Date(b.fechaHoraInicio).getTime());
  }

  turnosSinAsignar() {
    return this.turnos()
      .filter(t => !t.barbero || !t.barbero.id)
      .sort((a, b) => new Date(a.fechaHoraInicio).getTime() - new Date(b.fechaHoraInicio).getTime());
  }

  cambiarEstado(id: string, nuevoEstado: string) {
    if (confirm(`¿Confirmas que deseas marcar este turno como ${nuevoEstado}?`)) {
      this.reservasService.cambiarEstado(id, nuevoEstado).subscribe(() => {
        this.cargarDatos();
      });
    }
  }

  iniciarCobro(turno: any) {
    this.turnoACobrar.set(turno);
  }

  onCobroExitoso() {
    this.turnoACobrar.set(null);
    this.cargarDatos();
  }

  abrirFicha(cliente: any) {
    this.clienteSeleccionado.set(cliente);
  }

  onWalkInCreado() {
    this.mostrarModalWalkIn.set(false);
    this.cargarDatos();
  }
}
