import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensajeDeError } from '../../../core/utils/error-message';
import {
  ActualizarPersonalRequest,
  InvitarPersonalRequest,
  PersonalService,
  Personal,
} from '../../../core/services/personal.service';
import { HorariosService, ExcepcionHorario } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';
import { PATRON_TELEFONO, sanearTelefono } from '../../../core/utils/telefono.util';

import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';
import { AuthService } from '../../../auth/auth.service';

@Component({
  selector: 'app-admin-personal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ModalShellComponent],
  template: `
    <div class="space-y-8 pb-12 animate-fade-in relative z-10">
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 relative"
      >
        <div class="space-y-1">
          <h2
            class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight drop-shadow-md"
          >
            Gestión de <span class="text-amber-400">Personal</span>
          </h2>
          <p class="text-zinc-400 text-sm sm:text-base">
            Administra los barberos y staff de tu barbería.
          </p>
        </div>

        @if (puedeGestionarPersonal()) {
          <button
            type="button"
            (click)="invitarMiembro()"
            class="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 shadow-[0_5px_20px_rgba(251,191,36,0.2)] hover:shadow-[0_10px_30px_rgba(251,191,36,0.4)] transition-all"
          >
            <i class="pi pi-user-plus mr-2"></i>Invitar Miembro
          </button>
        }
      </div>

      <div
        class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 relative overflow-hidden"
      >
        <div
          class="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl"
        ></div>

        @if (cargando()) {
          <div class="flex justify-center items-center py-12">
            <i class="pi pi-spinner pi-spin text-4xl text-amber-500/50"></i>
          </div>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
            @for (miembro of personal(); track miembro.id) {
              <div
                class="bg-zinc-900/50 border border-white/5 hover:border-amber-500/30 transition-all rounded-2xl p-5 flex flex-col gap-3 group"
              >
                <div class="flex justify-between items-start">
                  <div
                    class="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-lg"
                  >
                    {{ miembro.nombreCompleto.charAt(0).toUpperCase() }}
                  </div>
                  <div class="flex gap-1">
                    @for (rol of miembro.roles; track rol) {
                      <span
                        class="text-[9px] uppercase tracking-wider font-bold px-2 py-1 rounded bg-zinc-800 text-zinc-300"
                      >
                        {{ rol.replace('_', ' ') }}
                      </span>
                    }
                  </div>
                </div>

                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="text-white font-bold text-lg">{{ miembro.nombreCompleto }}</h3>
                    <span
                      class="text-[9px] uppercase tracking-wider font-bold px-2 py-1 rounded"
                      [class.bg-emerald-500/10]="miembro.estadoSede === 'ACTIVO'"
                      [class.text-emerald-300]="miembro.estadoSede === 'ACTIVO'"
                      [class.bg-zinc-700]="miembro.estadoSede === 'INACTIVO'"
                      [class.text-zinc-300]="miembro.estadoSede === 'INACTIVO'"
                    >
                      {{ miembro.estadoSede }}
                    </span>
                  </div>
                  <div class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
                    <i class="pi pi-envelope text-xs"></i> {{ miembro.correo }}
                  </div>
                  <div class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
                    <i class="pi pi-phone text-xs"></i> {{ miembro.telefono || 'Sin teléfono' }}
                  </div>
                </div>

                <div class="mt-auto pt-4 flex gap-2 border-t border-white/5">
                  @if (puedeGestionarPersonal()) {
                    <button
                      type="button"
                      (click)="editarMiembro(miembro)"
                      [attr.aria-label]="'Editar datos de ' + miembro.nombreCompleto"
                      class="flex-1 text-xs font-medium bg-white/5 hover:bg-white/10 text-white py-2 rounded-lg transition-colors"
                    >
                      Editar
                    </button>
                  }
                  <button
                    (click)="abrirModalExcepcion(miembro)"
                    class="flex-1 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 py-2 rounded-lg transition-colors border border-amber-500/30"
                  >
                    <i class="pi pi-calendar-times mr-1"></i> Excepción
                  </button>
                  @if (puedeGestionarPersonal()) {
                    <button
                      type="button"
                      (click)="eliminarMiembro(miembro)"
                      [attr.aria-label]="'Desactivar a ' + miembro.nombreCompleto + ' en esta sede'"
                      class="w-10 flex items-center justify-center text-zinc-500 hover:text-red-400 bg-white/5 hover:bg-red-400/10 rounded-lg transition-colors"
                    >
                      <i class="pi pi-user-minus"></i>
                    </button>
                  }
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
        (cerrar)="cerrarModal()"
      >
        <div class="space-y-4">
          <div>
            <label
              for="personal-excepcion-fecha"
              class="block text-xs font-medium text-zinc-400 mb-1"
              >Fecha</label
            >
            <input
              id="personal-excepcion-fecha"
              type="date"
              [(ngModel)]="excepcionModel.fecha"
              class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>

          <div>
            <label
              for="personal-excepcion-tipo"
              class="block text-xs font-medium text-zinc-400 mb-1"
              >Tipo de Excepción</label
            >
            <select
              id="personal-excepcion-tipo"
              [(ngModel)]="excepcionModel.tipo"
              class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
            >
              <option value="CERRADA">Día Libre Completo</option>
              <option value="HORARIO_ESPECIAL">Horario Especial (Parcial)</option>
            </select>
          </div>

          @if (excepcionModel.tipo === 'HORARIO_ESPECIAL') {
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label
                  for="personal-excepcion-inicio"
                  class="block text-xs font-medium text-zinc-400 mb-1"
                  >Hora Inicio</label
                >
                <input
                  id="personal-excepcion-inicio"
                  type="time"
                  [(ngModel)]="excepcionModel.horaInicio"
                  class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                />
              </div>
              <div>
                <label
                  for="personal-excepcion-fin"
                  class="block text-xs font-medium text-zinc-400 mb-1"
                  >Hora Fin</label
                >
                <input
                  id="personal-excepcion-fin"
                  type="time"
                  [(ngModel)]="excepcionModel.horaFin"
                  class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                />
              </div>
            </div>
          }

          <div>
            <label
              for="personal-excepcion-motivo"
              class="block text-xs font-medium text-zinc-400 mb-1"
              >Motivo (Opcional)</label
            >
            <input
              id="personal-excepcion-motivo"
              type="text"
              [(ngModel)]="excepcionModel.motivo"
              placeholder="Ej. Cita médica, Vacaciones..."
              class="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/50 transition-colors"
            />
          </div>
        </div>

        <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
          <button
            (click)="cerrarModal()"
            class="flex-1 py-3 px-4 rounded-xl font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
          <button
            (click)="guardarExcepcion()"
            class="flex-1 py-3 px-4 rounded-xl font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 hover:brightness-110 transition-all shadow-[0_0_15px_rgba(251,191,36,0.3)]"
          >
            <i class="pi pi-check mr-2"></i>Guardar
          </button>
        </div>
      </app-modal-shell>

      <!-- Alta y edición de personal -->
      <app-modal-shell
        [visible]="formularioPersonalAbierto()"
        [titulo]="
          modoFormulario() === 'invitar'
            ? 'Invitar miembro de personal'
            : 'Editar miembro de personal'
        "
        [subtitulo]="
          modoFormulario() === 'editar'
            ? (miembroSeleccionado()?.nombreCompleto ?? null)
            : 'Asignación para ' + (tenantService.nombreBarberiaActiva() || 'la sede activa')
        "
        icono="pi pi-users"
        ancho="lg"
        [cerrarBloqueado]="guardandoPersonal()"
        (cerrar)="cerrarFormularioPersonal()"
      >
        @if (modoFormulario() === 'invitar') {
          <form
            [formGroup]="formularioInvitacion"
            (ngSubmit)="guardarInvitacion()"
            class="space-y-4"
            novalidate
          >
            <div>
              <label
                for="personal-invitar-nombre"
                class="block text-xs font-medium text-zinc-300 mb-1"
                >Nombre completo</label
              >
              <input
                id="personal-invitar-nombre"
                type="text"
                formControlName="nombreCompleto"
                autocomplete="name"
                required
                aria-required="true"
                [attr.aria-invalid]="campoInvalido(formularioInvitacion, 'nombreCompleto')"
                [attr.aria-describedby]="
                  campoInvalido(formularioInvitacion, 'nombreCompleto')
                    ? 'personal-invitar-nombre-error'
                    : null
                "
                class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
              />
              @if (campoInvalido(formularioInvitacion, 'nombreCompleto')) {
                <p id="personal-invitar-nombre-error" class="mt-1 text-xs text-rose-300">
                  Escribe el nombre completo.
                </p>
              }
            </div>
            <div>
              <label
                for="personal-invitar-correo"
                class="block text-xs font-medium text-zinc-300 mb-1"
                >Correo electrónico</label
              >
              <input
                id="personal-invitar-correo"
                type="email"
                formControlName="correo"
                autocomplete="email"
                required
                aria-required="true"
                [attr.aria-invalid]="campoInvalido(formularioInvitacion, 'correo')"
                [attr.aria-describedby]="
                  campoInvalido(formularioInvitacion, 'correo')
                    ? 'personal-invitar-correo-error'
                    : null
                "
                class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
              />
              @if (campoInvalido(formularioInvitacion, 'correo')) {
                <p id="personal-invitar-correo-error" class="mt-1 text-xs text-rose-300">
                  Escribe un correo electrónico válido.
                </p>
              }
            </div>
            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label
                  for="personal-invitar-telefono"
                  class="block text-xs font-medium text-zinc-300 mb-1"
                  >Teléfono (10 dígitos)</label
                >
                <input
                  id="personal-invitar-telefono"
                  type="tel"
                  inputmode="numeric"
                  formControlName="telefono"
                  autocomplete="tel"
                  maxlength="10"
                  required
                  aria-required="true"
                  (input)="onTelefonoInput($event, formularioInvitacion)"
                  [attr.aria-invalid]="campoInvalido(formularioInvitacion, 'telefono')"
                  [attr.aria-describedby]="
                    campoInvalido(formularioInvitacion, 'telefono')
                      ? 'personal-invitar-telefono-error'
                      : null
                  "
                  class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
                />
                @if (campoInvalido(formularioInvitacion, 'telefono')) {
                  <p id="personal-invitar-telefono-error" class="mt-1 text-xs text-rose-300">
                    El teléfono debe tener 10 dígitos.
                  </p>
                }
              </div>
              <div>
                <label
                  for="personal-invitar-rol"
                  class="block text-xs font-medium text-zinc-300 mb-1"
                  >Rol de sede</label
                >
                <select
                  id="personal-invitar-rol"
                  formControlName="rolNombre"
                  required
                  aria-required="true"
                  class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
                >
                  <option value="BARBERO">Barbero</option>
                  <option value="ADMIN_BARBERIA">Administrador de sede</option>
                </select>
              </div>
            </div>
            <div>
              <label
                for="personal-invitar-password"
                class="block text-xs font-medium text-zinc-300 mb-1"
                >Contraseña inicial</label
              >
              <input
                id="personal-invitar-password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                required
                aria-required="true"
                aria-describedby="personal-invitar-password-ayuda"
                [attr.aria-invalid]="campoInvalido(formularioInvitacion, 'password')"
                class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
              />
              <p id="personal-invitar-password-ayuda" class="mt-1 text-xs text-zinc-500">
                Mínimo 8 caracteres, con al menos una letra y un número. Comparte la clave inicial
                de forma segura.
              </p>
            </div>
            @if (errorPersonal()) {
              <p role="alert" class="text-sm text-rose-300">{{ errorPersonal() }}</p>
            }
            <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
              <button
                type="button"
                (click)="cerrarFormularioPersonal()"
                [disabled]="guardandoPersonal()"
                class="flex-1 py-3 rounded-xl font-medium text-zinc-300 bg-white/5 hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="formularioInvitacion.invalid || guardandoPersonal()"
                class="flex-1 py-3 rounded-xl font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 disabled:opacity-50"
              >
                {{ guardandoPersonal() ? 'Creando cuenta…' : 'Crear miembro' }}
              </button>
            </div>
          </form>
        } @else {
          <form
            [formGroup]="formularioEdicion"
            (ngSubmit)="guardarEdicionPersonal()"
            class="space-y-4"
            novalidate
          >
            <div>
              <label
                for="personal-editar-nombre"
                class="block text-xs font-medium text-zinc-300 mb-1"
                >Nombre completo</label
              >
              <input
                id="personal-editar-nombre"
                type="text"
                [value]="miembroSeleccionado()?.nombreCompleto ?? ''"
                readonly
                autocomplete="name"
                aria-describedby="personal-editar-nombre-ayuda"
                class="w-full bg-zinc-950/70 border border-white/10 rounded-xl px-4 py-3 text-zinc-400 cursor-not-allowed"
              />
              <p id="personal-editar-nombre-ayuda" class="mt-1 text-xs text-zinc-500">
                Este dato pertenece a la cuenta global y no se modifica desde una sede.
              </p>
            </div>
            <div class="grid sm:grid-cols-3 gap-4">
              <div>
                <label
                  for="personal-editar-telefono"
                  class="block text-xs font-medium text-zinc-300 mb-1"
                  >Teléfono (10 dígitos)</label
                >
                <input
                  id="personal-editar-telefono"
                  type="tel"
                  inputmode="numeric"
                  [value]="miembroSeleccionado()?.telefono ?? ''"
                  readonly
                  autocomplete="tel"
                  aria-describedby="personal-editar-telefono-ayuda"
                  class="w-full bg-zinc-950/70 border border-white/10 rounded-xl px-4 py-3 text-zinc-400 cursor-not-allowed"
                />
                <p id="personal-editar-telefono-ayuda" class="mt-1 text-xs text-zinc-500">
                  El teléfono pertenece a la cuenta global y no se modifica desde una sede.
                </p>
              </div>
              <div>
                <label
                  for="personal-editar-estado"
                  class="block text-xs font-medium text-zinc-300 mb-1"
                  >Estado en esta sede</label
                >
                <select
                  id="personal-editar-estado"
                  formControlName="estado"
                  class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
                >
                  <option value="ACTIVO">Activo</option>
                  <option value="INACTIVO">Inactivo</option>
                </select>
              </div>
              <div>
                <label
                  for="personal-editar-rol"
                  class="block text-xs font-medium text-zinc-300 mb-1"
                  >Rol de sede</label
                >
                <select
                  id="personal-editar-rol"
                  formControlName="rolNombre"
                  class="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500/60"
                >
                  <option value="BARBERO">Barbero</option>
                  <option value="ADMIN_BARBERIA">Administrador de sede</option>
                </select>
              </div>
            </div>
            @if (errorPersonal()) {
              <p role="alert" class="text-sm text-rose-300">{{ errorPersonal() }}</p>
            }
            <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
              <button
                type="button"
                (click)="cerrarFormularioPersonal()"
                [disabled]="guardandoPersonal()"
                class="flex-1 py-3 rounded-xl font-medium text-zinc-300 bg-white/5 hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="formularioEdicion.invalid || guardandoPersonal()"
                class="flex-1 py-3 rounded-xl font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-600 disabled:opacity-50"
              >
                {{ guardandoPersonal() ? 'Guardando…' : 'Guardar cambios' }}
              </button>
            </div>
          </form>
        }
      </app-modal-shell>
    </div>
  `,
})
export class AdminPersonalComponent implements OnInit {
  private tenantService = inject(TenantService);
  private authService = inject(AuthService);
  private personalService = inject(PersonalService);
  private horariosService = inject(HorariosService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  personal = signal<Personal[]>([]);
  cargando = signal(true);
  readonly puedeGestionarPersonal = computed(() => {
    const roles = this.authService.authState().user?.roles ?? [];
    return roles.includes('ADMINISTRADOR') || roles.includes('ADMIN_BARBERIA');
  });
  private readonly fb = inject(FormBuilder);
  readonly formularioInvitacion = this.fb.group({
    nombreCompleto: ['', [Validators.required, Validators.maxLength(150)]],
    correo: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
    telefono: ['', [Validators.required, Validators.pattern(PATRON_TELEFONO)]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(72),
        Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/),
      ],
    ],
    rolNombre: ['BARBERO' as 'BARBERO' | 'ADMIN_BARBERIA', Validators.required],
  });
  readonly formularioEdicion = this.fb.group({
    estado: ['ACTIVO' as 'ACTIVO' | 'INACTIVO', Validators.required],
    rolNombre: ['BARBERO' as 'BARBERO' | 'ADMIN_BARBERIA', Validators.required],
  });
  formularioPersonalAbierto = signal(false);
  modoFormulario = signal<'invitar' | 'editar'>('invitar');
  guardandoPersonal = signal(false);
  errorPersonal = signal<string | null>(null);
  miembroSeleccionado = signal<Personal | null>(null);

  // Estado del Modal
  modalAbierto = signal(false);
  barberoSeleccionado = signal<Personal | null>(null);
  excepcionModel: Partial<ExcepcionHorario> = {
    tipo: 'CERRADA',
    fecha: '',
    horaInicio: '',
    horaFin: '',
    motivo: '',
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
      },
    });
  }

  abrirModalExcepcion(barbero: Personal) {
    this.barberoSeleccionado.set(barbero);
    this.excepcionModel = {
      tipo: 'CERRADA',
      fecha: this.hoyLocal(),
      horaInicio: '',
      horaFin: '',
      motivo: '',
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

    if (
      this.excepcionModel.tipo === 'HORARIO_ESPECIAL' &&
      (!this.excepcionModel.horaInicio || !this.excepcionModel.horaFin)
    ) {
      this.toast.warning(
        'Debes definir hora de inicio y fin para un horario especial.',
        'Falta un dato',
      );
      return;
    }

    this.horariosService
      .agregarExcepcionBarbero(barberia.id, barbero.id, this.excepcionModel as ExcepcionHorario)
      .subscribe({
        next: () => {
          this.toast.success(
            'La excepción quedó guardada en el horario del barbero.',
            'Excepción guardada',
          );
          this.cerrarModal();
        },
        error: (err) => {
          // El aviso al usuario lo da el interceptor global: aquí solo se deja el
          // rastro para depurar. El modal sigue abierto para corregir los datos
          // sin tener que volver a escribirlos.
          console.error('Error al guardar la excepción', err);
        },
      });
  }

  invitarMiembro() {
    if (!this.puedeGestionarPersonal()) return;
    this.modoFormulario.set('invitar');
    this.miembroSeleccionado.set(null);
    this.errorPersonal.set(null);
    this.formularioInvitacion.reset({
      nombreCompleto: '',
      correo: '',
      telefono: '',
      password: '',
      rolNombre: 'BARBERO',
    });
    this.formularioPersonalAbierto.set(true);
  }

  editarMiembro(miembro: Personal) {
    if (!this.puedeGestionarPersonal()) return;
    this.modoFormulario.set('editar');
    this.miembroSeleccionado.set(miembro);
    this.errorPersonal.set(null);
    this.formularioEdicion.reset({
      estado: miembro.estadoSede ?? 'ACTIVO',
      rolNombre: miembro.roles.includes('ADMIN_BARBERIA') ? 'ADMIN_BARBERIA' : 'BARBERO',
    });
    this.formularioPersonalAbierto.set(true);
  }

  /**
   * Deja en el control solo los dígitos del teléfono.
   *
   * Sin esto, pegar "809-555-0101" dejaba el formulario inválido con un mensaje
   * que no explicaba nada y el usuario tenía que limpiarlo a mano. Se escribe en
   * el `<input>` y en el control a la vez para que ambos queden sincronizados sin
   * disparar otra ronda de validación por cada tecla borrada.
   */
  onTelefonoInput(evento: Event, formulario: FormGroup): void {
    const input = evento.target as HTMLInputElement;
    const limpio = sanearTelefono(input.value);
    if (input.value === limpio) return;

    input.value = limpio;
    formulario.get('telefono')?.setValue(limpio, { emitEvent: false });
  }

  campoInvalido(formulario: FormGroup, nombre: string): boolean {
    const control = formulario.get(nombre);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  cerrarFormularioPersonal(): void {
    if (this.guardandoPersonal()) return;
    this.formularioPersonalAbierto.set(false);
    this.miembroSeleccionado.set(null);
    this.errorPersonal.set(null);
  }

  guardarInvitacion(): void {
    if (this.formularioInvitacion.invalid || this.guardandoPersonal()) {
      this.formularioInvitacion.markAllAsTouched();
      return;
    }
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) {
      this.toast.error('Selecciona una sede activa para invitar personal.', 'Sede requerida');
      return;
    }
    const dto = this.formularioInvitacion.getRawValue() as InvitarPersonalRequest;
    dto.nombreCompleto = dto.nombreCompleto.trim();
    dto.correo = dto.correo.trim();
    this.guardandoPersonal.set(true);
    this.errorPersonal.set(null);
    this.personalService.invitarMiembro(barberia.id, dto).subscribe({
      next: (miembro) => {
        this.guardandoPersonal.set(false);
        this.personal.update((actual) => [...actual, miembro]);
        this.cerrarFormularioPersonal();
        this.toast.success(
          `${miembro.nombreCompleto} ya forma parte del personal de la sede.`,
          'Miembro creado',
        );
      },
      error: (err) => this.manejarErrorPersonal(err, 'No se pudo crear el miembro.'),
    });
  }

  guardarEdicionPersonal(): void {
    if (this.formularioEdicion.invalid || this.guardandoPersonal()) {
      this.formularioEdicion.markAllAsTouched();
      return;
    }
    const barberia = this.tenantService.barberiaActiva();
    const miembro = this.miembroSeleccionado();
    if (!barberia || !miembro) return;
    const dto = this.formularioEdicion.getRawValue() as ActualizarPersonalRequest;
    this.guardandoPersonal.set(true);
    this.errorPersonal.set(null);
    this.personalService.actualizarMiembro(barberia.id, miembro.id, dto).subscribe({
      next: (actualizado) => {
        this.guardandoPersonal.set(false);
        this.personal.update((actual) =>
          actual.map((item) => (item.id === actualizado.id ? actualizado : item)),
        );
        this.cerrarFormularioPersonal();
        this.toast.success(
          `Se guardaron los cambios de ${actualizado.nombreCompleto}.`,
          'Personal actualizado',
        );
      },
      error: (err) => this.manejarErrorPersonal(err, 'No se pudieron guardar los cambios.'),
    });
  }

  private manejarErrorPersonal(err: any, respaldo: string): void {
    this.guardandoPersonal.set(false);
    const mensaje = mensajeDeError(err, respaldo);
    this.errorPersonal.set(mensaje);
    this.toast.error(mensaje, 'No se pudo guardar');
  }

  async eliminarMiembro(miembro: Personal): Promise<void> {
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Desactivar en esta sede',
      mensaje: `${miembro.nombreCompleto} dejará de operar y de aparecer en la agenda de esta sede. Su cuenta y sus asignaciones en otras sedes no cambiarán.`,
      textoConfirmar: 'Desactivar',
      tono: 'peligro',
      icono: 'pi pi-user-minus',
    });
    if (!confirmado) return;

    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;
    const dto: ActualizarPersonalRequest = {
      estado: 'INACTIVO',
      rolNombre: miembro.roles.includes('ADMIN_BARBERIA') ? 'ADMIN_BARBERIA' : 'BARBERO',
    };
    this.personalService.actualizarMiembro(barberia.id, miembro.id, dto).subscribe({
      next: (actualizado) => {
        this.personal.update((actual) =>
          actual.map((item) => (item.id === actualizado.id ? actualizado : item)),
        );
        this.toast.success(
          `${miembro.nombreCompleto} quedó inactivo en esta sede.`,
          'Personal desactivado',
        );
      },
      error: (err) => {
        const mensaje = mensajeDeError(err, 'No se pudo desactivar al miembro.');
        this.toast.error(mensaje, 'No se pudo desactivar');
      },
    });
  }
}
