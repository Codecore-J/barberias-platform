import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PersonalService, Personal } from '../../../core/services/personal.service';
import { HorariosService, ExcepcionHorario } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';

import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

@Component({
  selector: 'app-admin-personal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalShellComponent],
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
                  <button (click)="eliminarMiembro(miembro)" [attr.aria-label]="'Eliminar a ' + miembro.nombreCompleto" class="w-10 flex items-center justify-center text-zinc-500 hover:text-red-400 bg-white/5 hover:bg-red-400/10 rounded-lg transition-colors">
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
      <app-modal-shell
        [visible]="modalAbierto()"
        titulo="Nueva Excepción"
        [subtitulo]="'Para ' + (barberoSeleccionado()?.nombreCompleto ?? '')"
        icono="pi pi-calendar-plus"
        (cerrar)="cerrarModal()">
              <div class="space-y-4">
                <div>
                  <label for="personal-excepcion-fecha" class="block text-xs font-medium text-zinc-400 mb-1">Fecha</label>
                  <input id="personal-excepcion-fecha" type="date" [(ngModel)]="excepcionModel.fecha" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                </div>

                <div>
                  <label for="personal-excepcion-tipo" class="block text-xs font-medium text-zinc-400 mb-1">Tipo de Excepción</label>
                  <select id="personal-excepcion-tipo" [(ngModel)]="excepcionModel.tipo" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    <option value="CERRADA">Día Libre Completo</option>
                    <option value="HORARIO_ESPECIAL">Horario Especial (Parcial)</option>
                  </select>
                </div>

                @if (excepcionModel.tipo === 'HORARIO_ESPECIAL') {
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label for="personal-excepcion-inicio" class="block text-xs font-medium text-zinc-400 mb-1">Hora Inicio</label>
                      <input id="personal-excepcion-inicio" type="time" [(ngModel)]="excepcionModel.horaInicio" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    </div>
                    <div>
                      <label for="personal-excepcion-fin" class="block text-xs font-medium text-zinc-400 mb-1">Hora Fin</label>
                      <input id="personal-excepcion-fin" type="time" [(ngModel)]="excepcionModel.horaFin" class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                    </div>
                  </div>
                }

                <div>
                  <label for="personal-excepcion-motivo" class="block text-xs font-medium text-zinc-400 mb-1">Motivo (Opcional)</label>
                  <input id="personal-excepcion-motivo" type="text" [(ngModel)]="excepcionModel.motivo" placeholder="Ej. Cita médica, Vacaciones..." class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors">
                </div>
              </div>

              <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
                <button (click)="cerrarModal()" class="flex-1 py-3 px-4 rounded-xl font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="guardarExcepcion()" class="flex-1 py-3 px-4 rounded-xl font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 hover:brightness-110 transition-all shadow-[0_0_15px_rgba(251,191,36,0.3)]">
                  <i class="pi pi-check mr-2"></i>Guardar
                </button>
              </div>
      </app-modal-shell>

    </div>
  `
})
export class AdminPersonalComponent implements OnInit {
  private tenantService = inject(TenantService);
  private personalService = inject(PersonalService);
  private horariosService = inject(HorariosService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  personal = signal<Personal[]>([]);
  cargando = signal(true);

  // Estado del Modal
  modalAbierto = signal(false);
  barberoSeleccionado = signal<Personal | null>(null);
  excepcionModel: Partial<ExcepcionHorario> = {
    tipo: 'CERRADA',
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
      tipo: 'CERRADA',
      fecha: this.hoyLocal(),
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

  /**
   * Día de HOY como etiqueta `YYYY-MM-DD` en la zona del navegador.
   *
   * `toISOString()` devuelve el día en UTC: a partir de las 20:00 en Santo
   * Domingo (UTC-4) ya es mañana, y el modal proponía una fecha futura.
   * La excepción se guarda en una columna `DATE`, así que el valor debe ser
   * el día de calendario del usuario, no un instante.
   */
  private hoyLocal(): string {
    const ahora = new Date();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${ahora.getFullYear()}-${mes}-${dia}`;
  }

  guardarExcepcion() {
    const barberia = this.tenantService.barberiaActiva();
    const barbero = this.barberoSeleccionado();
    if (!barberia || !barbero) return;

    if (!this.excepcionModel.fecha) {
      this.toast.warning('La fecha es obligatoria para registrar la excepción.', 'Falta un dato');
      return;
    }

    if (this.excepcionModel.tipo === 'HORARIO_ESPECIAL' && (!this.excepcionModel.horaInicio || !this.excepcionModel.horaFin)) {
      this.toast.warning(
        'Debes definir hora de inicio y fin para un horario especial.',
        'Falta un dato',
      );
      return;
    }

    this.horariosService.agregarExcepcionBarbero(
      barberia.id,
      barbero.id,
      this.excepcionModel as ExcepcionHorario
    ).subscribe({
      next: () => {
        this.toast.success('La excepción quedó guardada en el horario del barbero.', 'Excepción guardada');
        this.cerrarModal();
      },
      error: (err) => {
        // El aviso al usuario lo da el interceptor global: aquí solo se deja el
        // rastro para depurar. El modal sigue abierto para corregir los datos
        // sin tener que volver a escribirlos.
        console.error('Error al guardar la excepción', err);
      }
    });
  }

  invitarMiembro() {
    this.toast.info(
      'La invitación de nuevos miembros estará disponible próximamente.',
      'En desarrollo',
    );
  }

  editarMiembro(miembro: Personal) {
    this.toast.info(
      `La edición del perfil de ${miembro.nombreCompleto} estará disponible próximamente.`,
      'En desarrollo',
    );
  }

  async eliminarMiembro(miembro: Personal): Promise<void> {
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Retirar del equipo',
      mensaje: `¿Deseas eliminar a ${miembro.nombreCompleto} de la barbería? Dejará de recibir citas y de aparecer en la agenda.`,
      textoConfirmar: 'Sí, eliminar',
      tono: 'peligro',
      icono: 'pi pi-user-minus',
    });
    if (!confirmado) return;

    this.toast.warning(
      'La eliminación de miembros está en desarrollo: todavía no modifica la base de datos.',
      'En desarrollo',
    );
  }
}
