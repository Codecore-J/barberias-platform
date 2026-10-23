import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsuarioListResponse, UsuariosService } from '../../../core/services/usuarios.service';

/** Tope del backend (`CambiarEstadoCuentaDto`): 500 caracteres. */
const MOTIVO_MAXIMO = 500;

/**
 * Gestión de usuarios de la PLATAFORMA.
 *
 * Consume `GET /plataforma/usuarios`, que el backend declara
 * `@Roles('ADMINISTRADOR')`: la sede, el barbero y el cliente reciben 403. La
 * pantalla es transversal, así que su ruta no exige sede activa (sin
 * `tenantGuard`), igual que la bandeja de vinculaciones.
 *
 * Suspender o reactivar es una decisión manual, MOTIVADA y auditada (D09/D24):
 * el modal no deja confirmar sin motivo, avisa del estado al que va la cuenta y,
 * al terminar, recarga la lista para que la tabla muestre el estado nuevo.
 */
@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div
            class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1"
          >
            <i class="pi pi-shield text-xs"></i>
            <span>Administración de plataforma</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">
            Gestión de <span class="gold-gradient-text">Usuarios</span>
          </h2>
          <p class="text-sm text-zinc-400">
            Todas las cuentas de la plataforma, de la más reciente a la más antigua
          </p>
        </div>

        <button
          (click)="cargar()"
          class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2"
        >
          <i class="pi pi-refresh" [class.pi-spin]="service.isLoading()"></i> Refrescar
        </button>
      </div>

      <!-- Feedback -->
      @if (mensajeExito()) {
        <div
          class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2"
        >
          <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
        </div>
      }

      @if (service.error()) {
        <div
          class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
        >
          <i class="pi pi-exclamation-triangle"></i> {{ service.error() }}
        </div>
      }

      <!-- Estado de carga -->
      @if (service.isLoading() && service.usuarios().length === 0) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Tabla -->
      @if (!service.isLoading() || service.usuarios().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <p class="text-xs text-zinc-400">
              <span class="font-bold text-white">{{ service.usuarios().length }}</span>
              {{ service.usuarios().length === 1 ? 'cuenta registrada' : 'cuentas registradas' }}
            </p>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/60">
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Nombre
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Correo
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Teléfono
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Estado
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Fecha de Registro
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">
                    Roles
                  </th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (usuario of service.usuarios(); track usuario.id) {
                  <tr class="hover:bg-white/5 transition-colors group">
                    <td class="p-4">
                      <div class="font-bold text-white">{{ usuario.nombreCompleto }}</div>
                    </td>
                    <td class="p-4 text-zinc-300 break-all">{{ usuario.correo }}</td>
                    <td class="p-4 text-zinc-400 font-mono">
                      {{ usuario.telefono || '—' }}
                    </td>
                    <td class="p-4">
                      <span
                        class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5"
                        [ngClass]="claseEstado(usuario.estadoCuenta)"
                      >
                        <i class="pi" [ngClass]="iconoEstado(usuario.estadoCuenta)"></i>
                        {{ usuario.estadoCuenta }}
                      </span>
                    </td>
                    <td class="p-4 text-zinc-400 whitespace-nowrap">
                      {{ usuario.fechaRegistro ? (usuario.fechaRegistro | date: 'dd MMM yyyy') : '—' }}
                    </td>
                    <td class="p-4">
                      @if (usuario.roles.length > 0) {
                        <div class="flex flex-wrap gap-1.5">
                          @for (rol of usuario.roles; track rol) {
                            <span
                              class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                              [ngClass]="claseRol(rol)"
                            >
                              {{ rol }}
                            </span>
                          }
                        </div>
                      } @else {
                        <span class="text-zinc-500">—</span>
                      }
                    </td>
                    <td class="p-4">
                      <div class="flex items-center justify-end">
                        <button
                          (click)="abrirModal(usuario)"
                          class="px-3.5 py-2 rounded-xl font-semibold text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-1.5"
                        >
                          <i class="pi pi-sync"></i> Cambiar Estado
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (service.usuarios().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-inbox text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">No hay usuarios para mostrar.</p>
              <p class="text-xs text-zinc-500 mt-1">
                La bandeja se llena con cada alta de cuenta en la plataforma.
              </p>
            </div>
          }
        </div>
      }

      <!-- Modal: cambiar el estado de la cuenta (D09/D24) -->
      @if (isModalOpen() && usuarioSeleccionado(); as usuario) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div
            class="bg-zinc-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border"
            [ngClass]="
              estadoDestino() === 'SUSPENDIDO' ? 'border-rose-500/30' : 'border-emerald-500/30'
            "
          >
            <div class="p-6 space-y-5">
              <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                  <div
                    class="w-10 h-10 rounded-xl border flex items-center justify-center"
                    [ngClass]="
                      estadoDestino() === 'SUSPENDIDO'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    "
                  >
                    <i class="pi text-lg" [ngClass]="iconoEstado(estadoDestino())"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold text-white">
                      Cambiar estado de {{ usuario.nombreCompleto }}
                    </h3>
                    <p class="text-xs text-zinc-400">{{ usuario.correo }}</p>
                  </div>
                </div>
                <button
                  (click)="cerrarModal()"
                  [disabled]="procesando()"
                  class="text-zinc-500 hover:text-white disabled:opacity-40 transition-colors"
                >
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <!-- Aviso del estado al que pasa la cuenta -->
              <div
                class="p-3.5 rounded-xl border text-xs flex items-start gap-2.5"
                [ngClass]="
                  estadoDestino() === 'SUSPENDIDO'
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                "
              >
                <i
                  class="pi mt-0.5"
                  [ngClass]="estadoDestino() === 'SUSPENDIDO' ? 'pi-ban' : 'pi-replay'"
                ></i>
                <span>
                  La cuenta pasará de
                  <span class="font-bold">{{ usuario.estadoCuenta }}</span>
                  a
                  <span class="font-bold">{{ estadoDestino() }}</span>.
                  @if (estadoDestino() === 'SUSPENDIDO') {
                    Se cerrarán todas sus sesiones (los tokens ya emitidos dejan de valer).
                  } @else {
                    Podrá volver a iniciar sesión, pero las sesiones cerradas no se reabren.
                  }
                </span>
              </div>

              <div>
                <label class="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Motivo del cambio
                </label>
                <textarea
                  [(ngModel)]="motivoTexto"
                  name="motivo"
                  rows="3"
                  [maxlength]="MOTIVO_MAXIMO"
                  [disabled]="procesando()"
                  class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                  placeholder="Explica por qué se suspende o se reactiva esta cuenta"
                ></textarea>
                <p
                  class="text-[11px] mt-1.5"
                  [ngClass]="motivoValido() ? 'text-zinc-500' : 'text-rose-400'"
                >
                  Obligatorio · {{ motivoTexto().trim().length }}/{{ MOTIVO_MAXIMO }} caracteres
                </p>
              </div>

              @if (errorModal()) {
                <div
                  class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
                >
                  <i class="pi pi-exclamation-triangle"></i> {{ errorModal() }}
                </div>
              }

              <div class="flex gap-3 pt-2 border-t border-zinc-800">
                <button
                  (click)="cerrarModal()"
                  [disabled]="procesando()"
                  class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  (click)="confirmarCambioEstado()"
                  [disabled]="!motivoValido() || procesando()"
                  class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                  [ngClass]="
                    estadoDestino() === 'SUSPENDIDO'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                  "
                >
                  <i
                    class="pi"
                    [ngClass]="procesando() ? 'pi-spin pi-spinner' : 'pi-check'"
                  ></i>
                  <span>Confirmar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AdminUsuariosComponent implements OnInit {
  protected readonly service = inject(UsuariosService);
  protected readonly MOTIVO_MAXIMO = MOTIVO_MAXIMO;

  readonly isModalOpen = signal(false);
  readonly usuarioSeleccionado = signal<UsuarioListResponse | null>(null);
  readonly motivoTexto = signal('');
  readonly procesando = signal(false);
  readonly errorModal = signal<string | null>(null);
  readonly mensajeExito = signal('');

  /** El endpoint no alterna: recibe el estado al que hay que llevar la cuenta. */
  readonly estadoDestino = computed<'ACTIVO' | 'SUSPENDIDO'>(() =>
    this.usuarioSeleccionado()?.estadoCuenta === 'SUSPENDIDO' ? 'ACTIVO' : 'SUSPENDIDO',
  );

  /** El backend exige un motivo con contenido (422 `MOTIVO_REQUERIDO`). */
  readonly motivoValido = computed(() => this.motivoTexto().trim().length > 0);

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.service.obtenerUsuarios().subscribe({ error: () => undefined });
  }

  abrirModal(usuario: UsuarioListResponse): void {
    this.usuarioSeleccionado.set(usuario);
    this.motivoTexto.set('');
    this.errorModal.set(null);
    this.isModalOpen.set(true);
  }

  cerrarModal(): void {
    // Un envío en curso no se puede abandonar: el estado ya pudo cambiar.
    if (this.procesando()) {
      return;
    }
    this.isModalOpen.set(false);
    this.usuarioSeleccionado.set(null);
    this.motivoTexto.set('');
    this.errorModal.set(null);
  }

  confirmarCambioEstado(): void {
    const usuario = this.usuarioSeleccionado();
    const motivo = this.motivoTexto().trim();

    if (!usuario || !motivo || this.procesando()) {
      return;
    }

    const destino = this.estadoDestino();
    this.procesando.set(true);
    this.errorModal.set(null);

    this.service.cambiarEstadoUsuario(usuario.id, motivo, destino).subscribe({
      next: () => {
        this.procesando.set(false);
        this.isModalOpen.set(false);
        this.usuarioSeleccionado.set(null);
        this.motivoTexto.set('');
        this.avisar(
          destino === 'SUSPENDIDO'
            ? `Cuenta suspendida: ${usuario.nombreCompleto} perdió sus sesiones.`
            : `Cuenta reactivada: ${usuario.nombreCompleto} puede volver a entrar.`,
        );
        // El estado vive en el backend: la tabla se refresca con la verdad.
        this.cargar();
      },
      error: (err) => {
        this.procesando.set(false);
        this.errorModal.set(
          err.error?.mensaje ||
            err.error?.message ||
            'No se pudo cambiar el estado de la cuenta',
        );
      },
    });
  }

  claseEstado(estadoCuenta: string): string {
    return estadoCuenta === 'SUSPENDIDO'
      ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
  }

  iconoEstado(estadoCuenta: string): string {
    return estadoCuenta === 'SUSPENDIDO' ? 'pi-ban' : 'pi-check-circle';
  }

  /** El rol global se destaca; los de sede son contexto y van en zinc. */
  claseRol(rol: string): string {
    return rol === 'ADMINISTRADOR'
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
      : 'bg-zinc-800/80 text-zinc-300 border-zinc-700';
  }

  private avisar(texto: string): void {
    this.mensajeExito.set(texto);
    setTimeout(() => this.mensajeExito.set(''), 5000);
  }
}
