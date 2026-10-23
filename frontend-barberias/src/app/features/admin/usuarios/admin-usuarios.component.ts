import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BarberiaOpcion,
  CrearUsuarioRequest,
  ROLES_PLATAFORMA,
  RolPlataforma,
  UsuarioAuditoriaEvento,
  UsuarioListResponse,
  UsuariosService,
} from '../../../core/services/usuarios.service';

/** Tope del backend (`CambiarEstadoCuentaDto`): 500 caracteres. */
const MOTIVO_MAXIMO = 500;

/** Mismo mínimo que `/auth/register` y que `CrearUsuarioPlataformaDto`. */
const PASSWORD_MINIMO = 8;

type FiltroEstado = 'TODOS' | 'ACTIVO' | 'SUSPENDIDO';
type FiltroRol = 'TODOS' | RolPlataforma;

/**
 * Gestión de usuarios de la PLATAFORMA.
 *
 * Consume las cuatro rutas que el backend declara `@Roles('ADMINISTRADOR')`:
 * listado, alta, cambio de estado e historial de auditoría. La pantalla es
 * transversal (sin `tenantGuard`), igual que la bandeja de vinculaciones.
 *
 * Los KPIs y los filtros son `computed()` sobre la señal de usuarios: una sola
 * fuente de verdad y cero estado duplicado. Los dos formularios (alta y cambio
 * de estado) viven en señales porque su error pertenece al modal, no a la
 * tabla; el error de una operación nunca ensucia el listado.
 */
@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-6 bg-ambient-mesh">
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

        <div class="flex flex-wrap items-center gap-3">
          <button
            (click)="abrirCreacion()"
            class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2"
          >
            <i class="pi pi-plus"></i> Nuevo Usuario
          </button>
          <button
            (click)="cargar()"
            class="px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm text-zinc-300 bg-zinc-900/80 border border-zinc-700/60 hover:border-amber-500/40 hover:text-amber-300 transition-all flex items-center gap-2"
          >
            <i class="pi pi-refresh" [class.pi-spin]="service.isLoading()"></i> Refrescar
          </button>
        </div>
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

      <!-- KPIs -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="glass-panel p-4 rounded-2xl border border-white/5">
          <div class="flex items-center justify-between">
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
              Total de usuarios
            </p>
            <div
              class="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300"
            >
              <i class="pi pi-users text-sm"></i>
            </div>
          </div>
          <p class="text-2xl font-bold text-white mt-2">{{ totalUsuarios() }}</p>
          <p class="text-[11px] text-zinc-500 mt-1">Cuentas registradas</p>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5">
          <div class="flex items-center justify-between">
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
              Cuentas activas
            </p>
            <div
              class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400"
            >
              <i class="pi pi-check-circle text-sm"></i>
            </div>
          </div>
          <p class="text-2xl font-bold text-emerald-400 mt-2">{{ totalActivos() }}</p>
          <div class="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div class="h-full bg-emerald-500" [style.width.%]="porcentajeActivos()"></div>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5">
          <div class="flex items-center justify-between">
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
              Cuentas suspendidas
            </p>
            <div
              class="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400"
            >
              <i class="pi pi-ban text-sm"></i>
            </div>
          </div>
          <p class="text-2xl font-bold text-rose-400 mt-2">{{ totalSuspendidos() }}</p>
          <div class="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div class="h-full bg-rose-500" [style.width.%]="porcentajeSuspendidos()"></div>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5">
          <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
            Distribución por roles
          </p>
          <div class="mt-2 space-y-1.5">
            @for (fila of distribucionRoles(); track fila.rol) {
              <div class="flex items-center justify-between text-xs">
                <span class="text-zinc-400 truncate">{{ fila.rol }}</span>
                <span class="font-bold text-zinc-100 ml-2">{{ fila.total }}</span>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Filtros -->
      <div
        class="glass-panel rounded-2xl border border-white/10 p-4 flex flex-col lg:flex-row lg:items-center gap-3"
      >
        <div class="relative flex-1">
          <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"></i>
          <input
            [(ngModel)]="busqueda"
            name="busqueda"
            type="text"
            placeholder="Buscar por nombre, correo o teléfono"
            class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors"
          />
        </div>

        <select
          [(ngModel)]="filtroEstado"
          name="filtroEstado"
          class="bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 transition-colors"
        >
          <option ngValue="TODOS">Todos los estados</option>
          <option ngValue="ACTIVO">Activos</option>
          <option ngValue="SUSPENDIDO">Suspendidos</option>
        </select>

        <select
          [(ngModel)]="filtroRol"
          name="filtroRol"
          class="bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 transition-colors"
        >
          <option ngValue="TODOS">Todos los roles</option>
          @for (rol of ROLES_PLATAFORMA; track rol) {
            <option [ngValue]="rol">{{ rol }}</option>
          }
        </select>

        <button
          (click)="limpiarFiltros()"
          class="px-3 py-2.5 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors flex items-center gap-1.5"
        >
          <i class="pi pi-filter-slash"></i> Limpiar
        </button>
      </div>

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
              Mostrando <span class="font-bold text-white">{{ usuariosFiltrados().length }}</span> de
              <span class="font-bold text-white">{{ totalUsuarios() }}</span>
              {{ totalUsuarios() === 1 ? 'cuenta' : 'cuentas' }}
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
                @for (usuario of usuariosFiltrados(); track usuario.id) {
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
                      <div class="flex items-center justify-end gap-2">
                        <button
                          (click)="abrirHistorial(usuario)"
                          class="px-3 py-2 rounded-xl font-semibold text-xs text-zinc-300 bg-zinc-800/80 border border-zinc-700 hover:border-amber-500/40 hover:text-amber-300 transition-all flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <i class="pi pi-history"></i> Historial
                        </button>
                        <button
                          (click)="abrirModal(usuario)"
                          class="px-3 py-2 rounded-xl font-semibold text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-1.5 whitespace-nowrap"
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

          @if (totalUsuarios() === 0) {
            <div class="text-center py-20">
              <i class="pi pi-inbox text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">No hay usuarios para mostrar.</p>
              <p class="text-xs text-zinc-500 mt-1">
                La bandeja se llena con cada alta de cuenta en la plataforma.
              </p>
            </div>
          } @else if (usuariosFiltrados().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-filter-slash text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">Ningún usuario coincide con los filtros.</p>
              <button
                (click)="limpiarFiltros()"
                class="mt-3 text-xs font-semibold text-amber-400 hover:text-amber-300"
              >
                Limpiar filtros
              </button>
            </div>
          }
        </div>
      }

      <!-- Modal: alta de usuario -->
      @if (creacionAbierta()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div
            class="bg-zinc-900 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-amber-500/25 flex flex-col max-h-[92vh]"
          >
            <div class="p-6 border-b border-zinc-800 flex justify-between items-start shrink-0">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400"
                >
                  <i class="pi pi-user-plus text-lg"></i>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-white">Nuevo usuario</h3>
                  <p class="text-xs text-zinc-400">
                    Alta administrativa · la cuenta nace ACTIVA y queda auditada
                  </p>
                </div>
              </div>
              <button
                (click)="cerrarCreacion()"
                [disabled]="creando()"
                class="text-zinc-500 hover:text-white disabled:opacity-40 transition-colors"
              >
                <i class="pi pi-times text-xl"></i>
              </button>
            </div>

            <div class="p-6 overflow-y-auto space-y-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="sm:col-span-2">
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">
                    Nombre completo
                  </label>
                  <input
                    [(ngModel)]="formNombre"
                    name="formNombre"
                    type="text"
                    maxlength="150"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="Ana Pérez"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Correo</label>
                  <input
                    [(ngModel)]="formCorreo"
                    name="formCorreo"
                    type="email"
                    maxlength="150"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="ana@correo.com"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Teléfono</label>
                  <input
                    [(ngModel)]="formTelefono"
                    name="formTelefono"
                    type="tel"
                    maxlength="30"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="8090000000"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">
                    Cédula <span class="text-zinc-600 font-normal">(opcional)</span>
                  </label>
                  <input
                    [(ngModel)]="formCedula"
                    name="formCedula"
                    type="text"
                    inputmode="numeric"
                    maxlength="30"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="Solo dígitos"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Contraseña</label>
                  <input
                    [(ngModel)]="formPassword"
                    name="formPassword"
                    type="password"
                    maxlength="72"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="Mínimo 8, con letra y número"
                  />
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Rol</label>
                  <select
                    [(ngModel)]="formRol"
                    name="formRol"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                  >
                    @for (rol of ROLES_PLATAFORMA; track rol) {
                      <option [ngValue]="rol">{{ rol }}</option>
                    }
                  </select>
                </div>

                @if (rolRequiereSede()) {
                  <div>
                    <label class="block text-xs font-semibold text-zinc-400 mb-1.5">
                      Barbería <span class="text-rose-400">*</span>
                    </label>
                    <select
                      [(ngModel)]="formBarberiaId"
                      name="formBarberiaId"
                      [disabled]="creando() || cargandoBarberias()"
                      class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    >
                      <option value="">
                        {{ cargandoBarberias() ? 'Cargando sedes…' : 'Elige una sede' }}
                      </option>
                      @for (barberia of barberias(); track barberia.id) {
                        <option [ngValue]="barberia.id">{{ barberia.nombre }}</option>
                      }
                    </select>
                    @if (errorBarberias()) {
                      <p class="text-[11px] text-rose-400 mt-1.5">{{ errorBarberias() }}</p>
                    }
                  </div>
                }
              </div>

              <div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 text-[11px] text-zinc-400">
                <i class="pi pi-info-circle text-amber-400/80 mr-1"></i>
                {{ rolRequiereSede() ? 'Los roles de sede exigen barbería.' : 'Los roles GLOBAL no se asignan a una sede.' }}
                El correo, el teléfono y la cédula son únicos; la contraseña se guarda con bcrypt.
              </div>

              @if (errorCreacion()) {
                <div
                  class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
                >
                  <i class="pi pi-exclamation-triangle"></i> {{ errorCreacion() }}
                </div>
              }
            </div>

            <div class="p-4 border-t border-zinc-800 flex gap-3 shrink-0">
              <button
                (click)="cerrarCreacion()"
                [disabled]="creando()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                Cancelar
              </button>
              <button
                (click)="confirmarCreacion()"
                [disabled]="!formularioValido() || creando()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
              >
                <i class="pi" [ngClass]="creando() ? 'pi-spin pi-spinner' : 'pi-user-plus'"></i>
                <span>Crear usuario</span>
              </button>
            </div>
          </div>
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
                  <i class="pi" [ngClass]="procesando() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                  <span>Confirmar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Modal: historial de auditoría de la cuenta -->
      @if (historialAbierto() && usuarioHistorial(); as usuario) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div
            class="bg-zinc-900 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-amber-500/20 flex flex-col max-h-[92vh]"
          >
            <div class="p-6 border-b border-zinc-800 flex justify-between items-start shrink-0">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400"
                >
                  <i class="pi pi-history text-lg"></i>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-white">Historial de la cuenta</h3>
                  <p class="text-xs text-zinc-400">
                    {{ usuario.nombreCompleto }} · {{ usuario.correo }}
                  </p>
                </div>
              </div>
              <button
                (click)="cerrarHistorial()"
                class="text-zinc-500 hover:text-white transition-colors"
              >
                <i class="pi pi-times text-xl"></i>
              </button>
            </div>

            <div class="p-6 overflow-y-auto">
              @if (cargandoHistorial()) {
                <div class="flex justify-center py-16">
                  <i class="pi pi-spin pi-spinner text-3xl text-amber-500"></i>
                </div>
              } @else if (errorHistorial()) {
                <div
                  class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2"
                >
                  <i class="pi pi-exclamation-triangle"></i> {{ errorHistorial() }}
                </div>
              } @else if (eventos().length === 0) {
                <div class="text-center py-16">
                  <i class="pi pi-inbox text-4xl text-zinc-600 mb-3 block"></i>
                  <p class="text-zinc-300 font-medium text-sm">Sin eventos registrados.</p>
                  <p class="text-xs text-zinc-500 mt-1">
                    El alta, las suspensiones y las reactivaciones aparecen aquí.
                  </p>
                </div>
              } @else {
                <ol class="space-y-4">
                  @for (evento of eventos(); track evento.id) {
                    <li class="flex gap-3">
                      <div
                        class="w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center"
                        [ngClass]="claseAccion(evento.accion)"
                      >
                        <i class="pi text-sm" [ngClass]="iconoAccion(evento.accion)"></i>
                      </div>
                      <div class="flex-1 border-b border-white/5 pb-3 min-w-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <p class="text-sm font-bold text-white">
                            {{ etiquetaAccion(evento.accion) }}
                          </p>
                          <p class="text-[11px] text-zinc-500">
                            {{ evento.creadoAt ? (evento.creadoAt | date: 'dd MMM yyyy · HH:mm') : '—' }}
                          </p>
                        </div>

                        <div class="flex flex-wrap items-center gap-2 mt-1.5">
                          @if (estadoResultante(evento); as estado) {
                            <span
                              class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                              [ngClass]="claseEstado(estado)"
                            >
                              {{ estado }}
                            </span>
                          }
                          @if (sesionesCerradas(evento)) {
                            <span
                              class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/25"
                            >
                              Sesiones cerradas
                            </span>
                          }
                          @if (rolDelEvento(evento); as rol) {
                            <span
                              class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                              [ngClass]="claseRol(rol)"
                            >
                              {{ rol }}
                            </span>
                          }
                        </div>

                        @if (evento.motivo) {
                          <p class="text-xs text-zinc-300 mt-2">
                            <span class="text-zinc-500">Motivo:</span> {{ evento.motivo }}
                          </p>
                        }

                        <p class="text-[11px] text-zinc-500 mt-1">
                          @if (evento.actor) {
                            Por {{ evento.actor.nombreCompleto }} · {{ evento.actor.correo }}
                          } @else {
                            Sistema
                          }
                        </p>
                      </div>
                    </li>
                  }
                </ol>
              }
            </div>

            <div class="p-4 border-t border-zinc-800 flex justify-end shrink-0">
              <button
                (click)="cerrarHistorial()"
                class="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cerrar
              </button>
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
  protected readonly ROLES_PLATAFORMA = ROLES_PLATAFORMA;

  // ── Filtros ────────────────────────────────────────────────────────────────
  readonly busqueda = signal('');
  readonly filtroEstado = signal<FiltroEstado>('TODOS');
  readonly filtroRol = signal<FiltroRol>('TODOS');

  // ── KPIs (todo derivado de la señal de usuarios) ───────────────────────────
  readonly totalUsuarios = computed(() => this.service.usuarios().length);
  readonly totalActivos = computed(
    () => this.service.usuarios().filter((u) => u.estadoCuenta === 'ACTIVO').length,
  );
  readonly totalSuspendidos = computed(
    () => this.service.usuarios().filter((u) => u.estadoCuenta === 'SUSPENDIDO').length,
  );
  readonly porcentajeActivos = computed(() => {
    const total = this.totalUsuarios();
    return total === 0 ? 0 : Math.round((this.totalActivos() / total) * 100);
  });
  readonly porcentajeSuspendidos = computed(() => {
    const total = this.totalUsuarios();
    return total === 0 ? 0 : Math.round((this.totalSuspendidos() / total) * 100);
  });
  /**
   * Conteo por rol. Un usuario con varios roles suma en cada uno: la tarjeta
   * mide CUENTAS POR ROL, no cuentas distintas.
   */
  readonly distribucionRoles = computed(() =>
    ROLES_PLATAFORMA.map((rol) => ({
      rol,
      total: this.service.usuarios().filter((usuario) => usuario.roles.includes(rol)).length,
    })),
  );

  /** Búsqueda libre + estado + rol, combinados. */
  readonly usuariosFiltrados = computed(() => {
    const termino = this.busqueda().trim().toLowerCase();
    const estado = this.filtroEstado();
    const rol = this.filtroRol();

    return this.service.usuarios().filter((usuario) => {
      if (estado !== 'TODOS' && usuario.estadoCuenta !== estado) return false;
      if (rol !== 'TODOS' && !usuario.roles.includes(rol)) return false;
      if (!termino) return true;

      return [usuario.nombreCompleto, usuario.correo, usuario.telefono ?? ''].some((valor) =>
        valor.toLowerCase().includes(termino),
      );
    });
  });

  // ── Cambio de estado ───────────────────────────────────────────────────────
  readonly isModalOpen = signal(false);
  readonly usuarioSeleccionado = signal<UsuarioListResponse | null>(null);
  readonly motivoTexto = signal('');
  readonly procesando = signal(false);
  readonly errorModal = signal<string | null>(null);
  readonly mensajeExito = signal('');

  readonly estadoDestino = computed<'ACTIVO' | 'SUSPENDIDO'>(() =>
    this.usuarioSeleccionado()?.estadoCuenta === 'SUSPENDIDO' ? 'ACTIVO' : 'SUSPENDIDO',
  );
  readonly motivoValido = computed(() => this.motivoTexto().trim().length > 0);

  // ── Alta de usuario ────────────────────────────────────────────────────────
  readonly creacionAbierta = signal(false);
  readonly formNombre = signal('');
  readonly formCorreo = signal('');
  readonly formTelefono = signal('');
  readonly formCedula = signal('');
  readonly formPassword = signal('');
  readonly formRol = signal<RolPlataforma>('CLIENTE');
  readonly formBarberiaId = signal('');
  readonly creando = signal(false);
  readonly errorCreacion = signal<string | null>(null);
  readonly barberias = signal<BarberiaOpcion[]>([]);
  readonly cargandoBarberias = signal(false);
  readonly errorBarberias = signal<string | null>(null);

  /** ADMIN_BARBERIA y BARBERO son de ámbito BARBERIA: exigen sede (D05). */
  readonly rolRequiereSede = computed(
    () => this.formRol() === 'ADMIN_BARBERIA' || this.formRol() === 'BARBERO',
  );

  /** Espejo de la validación del backend, para no enviar un 400 evitable. */
  readonly formularioValido = computed(() => {
    const password = this.formPassword();

    if (!this.formNombre().trim()) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.formCorreo().trim())) return false;
    if (!this.formTelefono().trim()) return false;
    if (password.length < PASSWORD_MINIMO) return false;
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return false;

    const cedula = this.formCedula().trim();
    if (cedula && !/^\d+$/.test(cedula)) return false;

    if (this.rolRequiereSede() && !this.formBarberiaId()) return false;

    return true;
  });

  // ── Historial de auditoría ─────────────────────────────────────────────────
  readonly historialAbierto = signal(false);
  readonly usuarioHistorial = signal<UsuarioListResponse | null>(null);
  readonly eventos = signal<UsuarioAuditoriaEvento[]>([]);
  readonly cargandoHistorial = signal(false);
  readonly errorHistorial = signal<string | null>(null);

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.service.obtenerUsuarios().subscribe({ error: () => undefined });
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroEstado.set('TODOS');
    this.filtroRol.set('TODOS');
  }

  // ── Cambio de estado ───────────────────────────────────────────────────────

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

  // ── Alta de usuario ────────────────────────────────────────────────────────

  abrirCreacion(): void {
    this.formNombre.set('');
    this.formCorreo.set('');
    this.formTelefono.set('');
    this.formCedula.set('');
    this.formPassword.set('');
    this.formRol.set('CLIENTE');
    this.formBarberiaId.set('');
    this.errorCreacion.set(null);
    this.errorBarberias.set(null);
    this.creacionAbierta.set(true);

    // Las sedes solo se piden al abrir el modal y se reutilizan mientras viva la
    // pantalla; `listarBarberias` es la única ruta que las trae TODAS.
    if (this.barberias().length === 0) {
      this.cargarBarberias();
    }
  }

  cerrarCreacion(): void {
    if (this.creando()) return;
    this.creacionAbierta.set(false);
    this.errorCreacion.set(null);
  }

  confirmarCreacion(): void {
    if (!this.formularioValido() || this.creando()) {
      return;
    }

    const cedula = this.formCedula().trim();
    const requiereSede = this.rolRequiereSede();

    const dto: CrearUsuarioRequest = {
      nombreCompleto: this.formNombre().trim(),
      correo: this.formCorreo().trim(),
      telefono: this.formTelefono().trim(),
      password: this.formPassword(),
      rolNombre: this.formRol(),
      ...(cedula ? { cedula } : {}),
      ...(requiereSede ? { barberiaId: this.formBarberiaId() } : {}),
    };

    this.creando.set(true);
    this.errorCreacion.set(null);

    this.service.crearUsuario(dto).subscribe({
      next: (usuario) => {
        this.creando.set(false);
        this.creacionAbierta.set(false);
        this.avisar(
          `Cuenta creada: ${usuario.nombreCompleto} (${usuario.roles.join(', ') || usuario.estadoCuenta}).`,
        );
        this.cargar();
      },
      error: (err) => {
        this.creando.set(false);
        // 409 de duplicado y 422 de ámbito llegan con el `mensaje` de D40.
        this.errorCreacion.set(
          err.error?.mensaje || err.error?.message || 'No se pudo crear la cuenta',
        );
      },
    });
  }

  private cargarBarberias(): void {
    this.cargandoBarberias.set(true);
    this.errorBarberias.set(null);

    this.service.listarBarberias().subscribe({
      next: (barberias) => {
        this.barberias.set(barberias);
        this.cargandoBarberias.set(false);
      },
      error: (err) => {
        this.cargandoBarberias.set(false);
        this.errorBarberias.set(
          err.error?.mensaje ||
            err.error?.message ||
            'No se pudieron cargar las sedes: no se puede asignar un rol de sede.',
        );
      },
    });
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  abrirHistorial(usuario: UsuarioListResponse): void {
    this.usuarioHistorial.set(usuario);
    this.eventos.set([]);
    this.errorHistorial.set(null);
    this.historialAbierto.set(true);
    this.cargandoHistorial.set(true);

    this.service.obtenerAuditoriaUsuario(usuario.id).subscribe({
      next: (eventos) => {
        this.eventos.set(eventos);
        this.cargandoHistorial.set(false);
      },
      error: (err) => {
        this.cargandoHistorial.set(false);
        this.errorHistorial.set(
          err.error?.mensaje || err.error?.message || 'No se pudo cargar el historial de la cuenta',
        );
      },
    });
  }

  cerrarHistorial(): void {
    this.historialAbierto.set(false);
    this.usuarioHistorial.set(null);
    this.eventos.set([]);
    this.errorHistorial.set(null);
  }

  // ── Etiquetas y colores ────────────────────────────────────────────────────

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

  etiquetaAccion(accion: string): string {
    const etiquetas: Record<string, string> = {
      USUARIO_CREADO: 'Cuenta creada',
      CUENTA_SUSPENDIDA: 'Cuenta suspendida',
      CUENTA_REACTIVADA: 'Cuenta reactivada',
      RECUPERACION_PASSWORD_EXITOSA: 'Contraseña restablecida',
    };

    return etiquetas[accion] ?? accion.replaceAll('_', ' ').toLowerCase();
  }

  iconoAccion(accion: string): string {
    if (accion === 'CUENTA_SUSPENDIDA') return 'pi-ban';
    if (accion === 'CUENTA_REACTIVADA') return 'pi-replay';
    if (accion === 'USUARIO_CREADO') return 'pi-user-plus';
    return 'pi-info-circle';
  }

  claseAccion(accion: string): string {
    if (accion === 'CUENTA_SUSPENDIDA') {
      return 'bg-rose-500/10 border-rose-500/25 text-rose-400';
    }
    if (accion === 'CUENTA_REACTIVADA') {
      return 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400';
    }
    if (accion === 'USUARIO_CREADO') {
      return 'bg-amber-500/10 border-amber-500/25 text-amber-400';
    }
    return 'bg-zinc-800 border-zinc-700 text-zinc-400';
  }

  /** `contexto.nuevo.estadoCuenta` de una suspensión o reactivación. */
  estadoResultante(evento: UsuarioAuditoriaEvento): string | null {
    const nuevo = evento.contexto?.['nuevo'];

    if (!nuevo || typeof nuevo !== 'object' || Array.isArray(nuevo)) {
      return null;
    }

    const estado = (nuevo as Record<string, unknown>)['estadoCuenta'];
    return typeof estado === 'string' ? estado : null;
  }

  /** `contexto.sesionesCerradas`: solo las suspensiones cierran sesiones. */
  sesionesCerradas(evento: UsuarioAuditoriaEvento): boolean {
    return evento.contexto?.['sesionesCerradas'] === true;
  }

  /** `contexto.rol` del alta: con qué rol nació la cuenta. */
  rolDelEvento(evento: UsuarioAuditoriaEvento): string | null {
    const rol = evento.contexto?.['rol'];
    return typeof rol === 'string' ? rol : null;
  }

  private avisar(texto: string): void {
    this.mensajeExito.set(texto);
    setTimeout(() => this.mensajeExito.set(''), 5000);
  }
}
