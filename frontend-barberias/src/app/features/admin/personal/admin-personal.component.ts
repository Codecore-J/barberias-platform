import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersonalService, Personal } from '../../../core/services/personal.service';
import { HorariosService, ExcepcionHorario } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';

@Component({
  selector: 'app-admin-personal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-8 pb-12 animate-fade-in relative z-10">
      
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 relative">
        <div class="space-y-1">
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight drop-shadow-md">
            Gestión de <span class="text-amber-400">Personal</span>
          </h2>
          <p class="text-zinc-400 text-sm sm:text-base">Administra los barberos y staff de tu barbería.</p>
        </div>
        
        <button (click)="invitarMiembro()" class="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 shadow-[0_5px_20px_rgba(251,191,36,0.2)] hover:shadow-[0_10px_30px_rgba(251,191,36,0.4)] transition-all">
          <i class="pi pi-user-plus mr-2"></i>Invitar Miembro
        </button>
      </div>

      <div class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 relative overflow-hidden">
        <div class="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl"></div>

        @if (cargando()) {
          <div class="flex justify-center items-center py-12">
            <i class="pi pi-spinner pi-spin text-4xl text-amber-500/50"></i>
          </div>
        } @else {
          
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
            @for (miembro of personal(); track miembro.id) {
              <div class="bg-zinc-900/50 border border-white/5 hover:border-amber-500/30 transition-all rounded-2xl p-5 flex flex-col gap-3 group">
                <div class="flex justify-between items-start">
                  <div class="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg">
                    {{ miembro.nombreCompleto.charAt(0).toUpperCase() }}
                  </div>
                  <div class="flex gap-1">
                    @for (rol of miembro.roles; track rol) {
                      <span class="text-[9px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-zinc-800 text-zinc-300">
                        {{ rol.replace('_', ' ') }}
                      </span>
                    }
                  </div>
                </div>
                
                <div>
                  <h3 class="text-white font-bold text-lg">{{ miembro.nombreCompleto }}</h3>
                  <div class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
                    <i class="pi pi-envelope text-xs"></i> {{ miembro.correo }}
                  </div>
                  <div class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
                    <i class="pi pi-phone text-xs"></i> {{ miembro.telefono || 'Sin teléfono' }}
                  </div>
                </div>
                
                <div class="mt-auto pt-4 flex gap-2 border-t border-white/5">
                  <button (click)="editarMiembro(miembro)" class="flex-1 text-xs font-medium bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg transition-colors">
                    Editar
                  </button>
                  <button (click)="abrirModalExcepcion(miembro)" class="flex-1 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 py-2 rounded-lg transition-colors border border-amber-500/30">
                    <i class="pi pi-calendar-times mr-1"></i> Excepción
                  </button>
                  <button (click)="eliminarMiembro(miembro)" class="w-10 flex items-center justify-center text-zinc-500 hover:text-red-400 bg-white/5 hover:bg-red-400/10 rounded-lg transition-colors">
                    <i class="pi pi-trash"></i>
                  </button>
                </div>
              </div>
            } @empty {
              <div class="col-span-full py-12 text-center text-zinc-500">
                <i class="pi pi-users text-4xl mb-3 opacity-50"></i>
                <p>No hay personal registrado en esta barbería aún.</p>
              </div>
            }
          </div>

        }
      </div>

      <!-- Modal Excepción -->
      @if (modalAbierto()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div class="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-6">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-xl font-bold text-white">Nueva Excepción</h3>
                  <p class="text-sm text-zinc-400">Para {{ barberoSeleccionado()?.nombreCompleto }}</p>
                </div>
                <button (click)="cerrarModal()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-medium text-zinc-400 mb-1">Fecha</label>
                  <input type="date" [(ngModel)]="excepcionModel.fecha" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                </div>

                <div>
                  <label class="block text-xs font-medium text-zinc-400 mb-1">Tipo de Excepción</label>
                  <select [(ngModel)]="excepcionModel.tipo" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    <option value="DIA_LIBRE">Día Libre Completo</option>
                    <option value="HORARIO_ESPECIAL">Horario Especial (Parcial)</option>
                  </select>
                </div>

                @if (excepcionModel.tipo === 'HORARIO_ESPECIAL') {
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-zinc-400 mb-1">Hora Inicio</label>
                      <input type="time" [(ngModel)]="excepcionModel.horaInicio" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-zinc-400 mb-1">Hora Fin</label>
                      <input type="time" [(ngModel)]="excepcionModel.horaFin" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    </div>
                  </div>
                }

                <div>
                  <label class="block text-xs font-medium text-zinc-400 mb-1">Motivo (Opcional)</label>
                  <input type="text" [(ngModel)]="excepcionModel.motivo" placeholder="Ej. Cita médica, Vacaciones..." class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                </div>
              </div>

              <div class="flex gap-3 pt-4 border-t border-white/5">
                <button (click)="cerrarModal()" class="flex-1 py-3 px-4 rounded-xl font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="guardarExcepcion()" class="flex-1 py-3 px-4 rounded-xl font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 hover:brightness-110 transition-all shadow-[0_0_15px_rgba(251,191,36,0.3)]">
                  <i class="pi pi-check mr-2"></i>Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      }

    </div>
  `
})
export class AdminPersonalComponent implements OnInit {
  private tenantService = inject(TenantService);
  private personalService = inject(PersonalService);
  private horariosService = inject(HorariosService);

  personal = signal<Personal[]>([]);
  cargando = signal(true);

  // Estado del Modal
  modalAbierto = signal(false);
  barberoSeleccionado = signal<Personal | null>(null);
  excepcionModel: Partial<ExcepcionHorario> = {
    tipo: 'DIA_LIBRE',
    fecha: '',
    horaInicio: '',
    horaFin: '',
    motivo: ''
  };

  ngOnInit() {
    this.cargarPersonal();
  }

  cargarPersonal() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) {
      this.cargando.set(false);
      return;
    }

    this.personalService.obtenerPersonal(barberia.id).subscribe({
      next: (data) => {
        this.personal.set(data);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
      }
    });
  }

  abrirModalExcepcion(barbero: Personal) {
    this.barberoSeleccionado.set(barbero);
    this.excepcionModel = {
      tipo: 'DIA_LIBRE',
      fecha: new Date().toISOString().split('T')[0],
      horaInicio: '',
      horaFin: '',
      motivo: ''
    };
    this.modalAbierto.set(true);
  }

  cerrarModal() {
    this.modalAbierto.set(false);
    this.barberoSeleccionado.set(null);
  }

  guardarExcepcion() {
    const barberia = this.tenantService.barberiaActiva();
    const barbero = this.barberoSeleccionado();
    if (!barberia || !barbero) return;

    if (!this.excepcionModel.fecha) {
      alert('La fecha es obligatoria');
      return;
    }

    if (this.excepcionModel.tipo === 'HORARIO_ESPECIAL' && (!this.excepcionModel.horaInicio || !this.excepcionModel.horaFin)) {
      alert('Debes definir hora de inicio y fin para un horario especial');
      return;
    }

    this.horariosService.agregarExcepcionBarbero(
      barberia.id,
      barbero.id,
      this.excepcionModel as ExcepcionHorario
    ).subscribe({
      next: () => {
        alert('Excepción guardada correctamente');
        this.cerrarModal();
      },
      error: (err) => {
        console.error('Error al guardar', err);
        alert('Ocurrió un error al guardar la excepción');
      }
    });
  }

  invitarMiembro() {
    alert('Funcionalidad de invitar miembro en desarrollo');
  }

  editarMiembro(miembro: Personal) {
    alert(`Editar miembro: ${miembro.nombreCompleto} (en desarrollo)`);
  }

  eliminarMiembro(miembro: Personal) {
    if (confirm(`¿Estás seguro de que deseas eliminar a ${miembro.nombreCompleto} de la barbería?`)) {
      alert('Funcionalidad de eliminación en desarrollo');
    }
  }
}
