import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { mensajeDeError } from '../../../core/utils/error-message';
import { FormsModule } from '@angular/forms';
import {
  BarberiaOpcion,
  CrearUsuarioRequest,
  ROLES_PLATAFORMA,
  RolDeUsuario,
  RolPlataforma,
  UsuarioAuditoriaEvento,
  UsuarioListResponse,
  UsuariosService,
} from '../../../core/services/usuarios.service';
import { AuthService } from '../../../auth/auth.service';
import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';
import { ToastService } from '../../../shared/ui/toast/toast.service';

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
  imports: [CommonModule, DatePipe, FormsModule, ModalShellComponent],
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
                    <td class="p-4 text-zinc-300">
                      <span class="block max-w-[220px] truncate" [title]="usuario.correo">
                        {{ usuario.correo }}
                      </span>
                    </td>
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
                        <!--
                          I-05 · gestión de roles. Abre el detalle por sede: los
                          roles de barbería NO se pueden tocar sin saber en qué
                          sede están, y el rol global de administrador es el
                          único que se concede desde plataforma.
                        -->
                        <button
                          (click)="abrirRoles(usuario)"
                          class="px-3 py-2 rounded-xl font-semibold text-xs text-zinc-300 bg-zinc-800/80 border border-zinc-700 hover:border-amber-500/40 hover:text-amber-300 transition-all flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <i class="pi pi-shield"></i> Roles
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
      <app-modal-shell
        [visible]="creacionAbierta()"
        titulo="Nuevo usuario"
        subtitulo="Alta administrativa · la cuenta nace ACTIVA y queda auditada"
        icono="pi pi-user-plus"
        ancho="xl"
        [cerrarBloqueado]="creando()"
        (cerrar)="cerrarCreacion()">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="sm:col-span-2">
                  <label for="usuario-nombre" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                    Nombre completo
                  </label>
                  <input
                    id="usuario-nombre"
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
                  <label for="usuario-correo" class="block text-xs font-semibold text-zinc-400 mb-1.5">Correo</label>
                  <input
                    id="usuario-correo"
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
                  <label for="usuario-telefono" class="block text-xs font-semibold text-zinc-400 mb-1.5">Teléfono</label>
                  <input
                    id="usuario-telefono"
                    [ngModel]="formTelefono()"
                    (ngModelChange)="formTelefono.set(soloDigitos($event, 10))"
                    name="formTelefono"
                    type="tel"
                    inputmode="numeric"
                    autocomplete="tel-national"
                    maxlength="10"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="8095550199"
                  />
                  <p class="text-[11px] text-zinc-600 mt-1">Obligatorio · 10 dígitos, sin espacios ni guiones</p>
                </div>

                <div>
                  <label for="usuario-cedula" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                    Cédula <span class="text-zinc-600 font-normal">(opcional)</span>
                  </label>
                  <input
                    id="usuario-cedula"
                    [ngModel]="formCedula()"
                    (ngModelChange)="formCedula.set(soloDigitos($event, 11))"
                    name="formCedula"
                    type="text"
                    inputmode="numeric"
                    maxlength="11"
                    [disabled]="creando()"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                    placeholder="00112345678"
                  />
                  <p class="text-[11px] text-zinc-600 mt-1">Opcional · 11 dígitos si la ingresas</p>
                </div>

                <div>
                  <label for="usuario-password" class="block text-xs font-semibold text-zinc-400 mb-1.5">Contraseña</label>
                  <input
                    id="usuario-password"
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
                  <label for="usuario-rol" class="block text-xs font-semibold text-zinc-400 mb-1.5">Rol</label>
                  <select
                    id="usuario-rol"
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
                    <label for="usuario-barberia" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                      Barbería <span class="text-rose-400">*</span>
                    </label>
                    <select
                      id="usuario-barberia"
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

            <div modal-footer class="p-4 border-t border-zinc-800 flex gap-3 shrink-0">
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
      </app-modal-shell>

      <!-- Modal: cambiar el estado de la cuenta (D09/D24) -->
      @if (isModalOpen() && usuarioSeleccionado(); as usuario) {
        <app-modal-shell
          [visible]="true"
          [titulo]="'Cambiar estado de ' + usuario.nombreCompleto"
          [subtitulo]="usuario.correo"
          [icono]="iconoEstado(estadoDestino())"
          [tono]="estadoDestino() === 'SUSPENDIDO' ? 'peligro' : 'primario'"
          [cerrarBloqueado]="procesando()"
          (cerrar)="cerrarModal()">
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
                <label for="usuario-motivo-cambio" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Motivo del cambio
                </label>
                <textarea
                  id="usuario-motivo-cambio"
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
        </app-modal-shell>
      }

      <!-- Modal: historial de auditoría de la cuenta -->
      @if (historialAbierto() && usuarioHistorial(); as usuario) {
        <app-modal-shell
          [visible]="true"
          titulo="Historial de la cuenta"
          [subtitulo]="usuario.nombreCompleto + ' · ' + usuario.correo"
          icono="pi pi-history"
          ancho="xl"
          (cerrar)="cerrarHistorial()">
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

            <div modal-footer class="p-4 border-t border-zinc-800 flex justify-end shrink-0">
              <button
                (click)="cerrarHistorial()"
                class="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cerrar
              </button>
            </div>
        </app-modal-shell>
      }

      <!--
        I-05 · Roles de la cuenta, por sede.

        Se listan los vínculos reales de usuario_roles con la sede a la que
        pertenecen, porque «ADMIN_BARBERIA» sin saber en qué sede no dice nada y
        no se puede editar. El rol global de administrador se concede o se
        retira aquí; los de sede se cambian en su propia fila.
      -->
      @if (rolesAbierto() && usuarioRoles(); as usuario) {
        <app-modal-shell
          [visible]="true"
          titulo="Roles de la cuenta"
          [subtitulo]="usuario.nombreCompleto + ' · ' + usuario.correo"
          icono="pi pi-shield"
          ancho="xl"
          [cerrarBloqueado]="procesandoRol()"
          (cerrar)="cerrarRoles()">
          @if (errorRoles()) {
            <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
              <i class="pi pi-exclamation-triangle mt-0.5"></i>
              <span>{{ errorRoles() }}</span>
            </div>
          }

          @if (esUsuarioActual(usuario)) {
            <div class="p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60 text-[11px] text-zinc-400">
              Esta es tu cuenta: el backend no permite cambiarte tu propio rol de
              plataforma.
            </div>
          }

          <!-- Rol global de plataforma -->
          <div class="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-bold text-white flex items-center gap-2">
                <i class="pi pi-shield text-amber-400"></i>
                Administrador de plataforma
              </p>
              <p class="text-[11px] text-zinc-400 mt-0.5">
                Rol GLOBAL: no pertenece a ninguna sede y da acceso a toda la
                plataforma. Retirarlo cierra las sesiones abiertas de la cuenta.
              </p>
            </div>
            @if (esAdministradorPlataforma()) {
              <button
                (click)="retirarAdministrador()"
                [disabled]="procesandoRol() || esUsuarioActual(usuario)"
                class="px-4 py-2.5 rounded-xl text-xs font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap flex items-center gap-2">
                <i class="pi" [ngClass]="procesandoRol() ? 'pi-spin pi-spinner' : 'pi-times-circle'"></i>
                Retirar rol
              </button>
            } @else {
              <button
                (click)="concederAdministrador()"
                [disabled]="procesandoRol()"
                class="px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg disabled:opacity-40 transition-all whitespace-nowrap flex items-center gap-2">
                <i class="pi" [ngClass]="procesandoRol() ? 'pi-spin pi-spinner' : 'pi-check-circle'"></i>
                Conceder rol
              </button>
            }
          </div>

          <!-- Roles de sede -->
          <div class="space-y-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Roles de sede
            </p>

            @if (rolesDeSede().length === 0) {
              <p class="text-xs text-zinc-400 p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50">
                Esta cuenta no está vinculada a ninguna sede. Los roles de sede se
                asignan desde Mi Personal, en la sede correspondiente.
              </p>
            } @else {
              @for (vinculo of rolesDeSede(); track vinculo.id) {
                <div class="rounded-2xl border border-zinc-700/60 bg-zinc-800/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-white truncate">
                      {{ vinculo.barberiaNombre ?? 'Sede' }}
                    </p>
                    <p class="text-[11px] text-zinc-400">
                      {{ vinculo.rolNombre }}
                      <span
                        class="ml-1 font-semibold"
                        [class.text-emerald-400]="vinculo.estado === 'ACTIVO'"
                        [class.text-rose-400]="vinculo.estado !== 'ACTIVO'"
                      >· {{ vinculo.estado }}</span>
                    </p>
                  </div>

                  <div class="flex items-center gap-2 shrink-0">
                    <select
                      [value]="vinculo.rolNombre"
                      (change)="cambiarRolSede(vinculo, $any($event.target).value)"
                      [disabled]="procesandoRol()"
                      aria-label="Rol en la sede"
                      class="bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                    >
                      <option value="BARBERO">BARBERO</option>
                      <option value="ADMIN_BARBERIA">ADMIN_BARBERIA</option>
                    </select>
                    @if (vinculo.estado === 'ACTIVO') {
                      <button
                        (click)="revocarAccesoSede(vinculo)"
                        [disabled]="procesandoRol()"
                        class="px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 transition-colors whitespace-nowrap">
                        Revocar
                      </button>
                    } @else {
                      <button
                        (click)="reactivarAccesoSede(vinculo)"
                        [disabled]="procesandoRol()"
                        class="px-3 py-2 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors whitespace-nowrap">
                        Reactivar
                      </button>
                    }
                  </div>
                </div>
              }
            }
          </div>

          <div modal-footer class="p-4 border-t border-zinc-800 flex justify-end shrink-0">
            <button
              (click)="cerrarRoles()"
              class="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
              Cerrar
            </button>
          </div>
        </app-modal-shell>
      }
    </div>
  `,
})
export class AdminUsuariosComponent implements OnInit {
  protected readonly service = inject(UsuariosService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
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

  /**
   * Deja solo dígitos y recorta a `maximo`. Pegar "+1 (809) 555-0199" en el
   * teléfono termina en "8095550199" en vez de viajar con formato libre al DTO
   * (donde ya sería un 400 de validación).
   */
  soloDigitos(valor: string, maximo: number): string {
    return (valor ?? '').replace(/\D/g, '').slice(0, maximo);
  }

  /** ADMIN_BARBERIA y BARBERO son de ámbito BARBERIA: exigen sede (D05). */
  readonly rolRequiereSede = computed(
    () => this.formRol() === 'ADMIN_BARBERIA' || this.formRol() === 'BARBERO',
  );

  /** Espejo de la validación del backend, para no enviar un 400 evitable. */
  readonly formularioValido = computed(() => {
    const password = this.formPassword();

    if (!this.formNombre().trim()) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.formCorreo().trim())) return false;
    // Mismo contrato que `CrearUsuarioPlataformaDto`: 10 dígitos exactos.
    if (!/^\d{10}$/.test(this.formTelefono())) return false;
    if (password.length < PASSWORD_MINIMO) return false;
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return false;

    // Y la cédula, 11 dígitos exactos si se indica (es opcional: hay clientes
    // extranjeros sin cédula dominicana).
    const cedula = this.formCedula().trim();
    if (cedula && !/^\d{11}$/.test(cedula)) return false;

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
        this.errorModal.set(mensajeDeError(err, 'No se pudo cambiar el estado de la cuenta'));
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

    // Nunca se manda `""`: el backend lo transforma a `undefined`, pero el
    // contrato del alta es omitir el campo cuando no hay cédula.
    const cedula = this.formCedula().trim();
    const requiereSede = this.rolRequiereSede();

    const dto: CrearUsuarioRequest = {
      nombreCompleto: this.formNombre().trim(),
      correo: this.formCorreo().trim(),
      telefono: this.formTelefono(),
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
        this.errorCreacion.set(mensajeDeError(err, 'No se pudo crear la cuenta'));
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
          mensajeDeError(err, 'No se pudieron cargar las sedes: no se puede asignar un rol de sede.'),
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
        this.errorHistorial.set(mensajeDeError(err, 'No se pudo cargar el historial de la cuenta'));
      },
    });
  }

  cerrarHistorial(): void {
    this.historialAbierto.set(false);
    this.usuarioHistorial.set(null);
    this.eventos.set([]);
    this.errorHistorial.set(null);
  }

  // ── I-05 · Roles de la cuenta ─────────────────────────────────────────────

  readonly rolesAbierto = signal(false);
  readonly usuarioRoles = signal<UsuarioListResponse | null>(null);
  readonly roles = signal<RolDeUsuario[]>([]);
  readonly cargandoRoles = signal(false);
  readonly procesandoRol = signal(false);
  readonly errorRoles = signal<string | null>(null);

  /** Los roles de sede son los que se pueden editar aquí; los globales, no. */
  readonly rolesDeSede = computed(() => this.roles().filter((r) => !!r.barberiaId));

  /** ¿La cuenta tiene el rol GLOBAL de administrador activo? */
  readonly esAdministradorPlataforma = computed(() =>
    this.roles().some((r) => r.rolNombre === 'ADMINISTRADOR' && r.estado === 'ACTIVO'),
  );

  /** El backend rechaza el autobloqueo (422 `ADMIN_PROPIO_ROL`): se desactiva antes. */
  esUsuarioActual(usuario: UsuarioListResponse): boolean {
    return this.authService.authState().user?.id === usuario.id;
  }

  abrirRoles(usuario: UsuarioListResponse): void {
    this.usuarioRoles.set(usuario);
    this.roles.set([]);
    this.errorRoles.set(null);
    this.rolesAbierto.set(true);
    this.cargarRoles(usuario.id);
  }

  cerrarRoles(): void {
    if (this.procesandoRol()) return;
    this.rolesAbierto.set(false);
    this.usuarioRoles.set(null);
    this.roles.set([]);
    this.errorRoles.set(null);
  }

  private cargarRoles(usuarioId: string): void {
    this.cargandoRoles.set(true);
    this.service.obtenerRolesUsuario(usuarioId).subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.cargandoRoles.set(false);
      },
      error: (err) => {
        this.cargandoRoles.set(false);
        this.errorRoles.set(mensajeDeError(err, 'No se pudieron cargar los roles de la cuenta'));
      },
    });
  }

  concederAdministrador(): void {
    this.cambiarAdministrador(true);
  }

  retirarAdministrador(): void {
    this.cambiarAdministrador(false);
  }

  private cambiarAdministrador(habilitado: boolean): void {
    const usuario = this.usuarioRoles();
    if (!usuario || this.procesandoRol()) return;

    this.procesandoRol.set(true);
    this.errorRoles.set(null);

    this.service.cambiarAdministrador(usuario.id, habilitado).subscribe({
      next: () => {
        this.procesandoRol.set(false);
        this.avisar(
          habilitado
            ? `${usuario.nombreCompleto} es ahora administrador de plataforma.`
            : `Se retiró el rol de administrador a ${usuario.nombreCompleto}.`,
        );
        this.recargar();
      },
      error: (err) => {
        this.procesandoRol.set(false);
        // Los 422 de negocio (último administrador, rol propio) se pintan tal cual.
        this.errorRoles.set(mensajeDeError(err, 'No se pudo cambiar el rol de plataforma'));
      },
    });
  }

  cambiarRolSede(vinculo: RolDeUsuario, rolNombre: string): void {
    if (!vinculo.barberiaId || this.procesandoRol()) return;
    if (rolNombre !== 'BARBERO' && rolNombre !== 'ADMIN_BARBERIA') return;
    if (rolNombre === vinculo.rolNombre) return;
    this.aplicarCambioSede(vinculo, { rolNombre }, `Rol actualizado en ${vinculo.barberiaNombre ?? 'la sede'}.`);
  }

  revocarAccesoSede(vinculo: RolDeUsuario): void {
    this.aplicarCambioSede(
      vinculo,
      { estado: 'INACTIVO' },
      `Acceso revocado en ${vinculo.barberiaNombre ?? 'la sede'}.`,
    );
  }

  reactivarAccesoSede(vinculo: RolDeUsuario): void {
    this.aplicarCambioSede(
      vinculo,
      { estado: 'ACTIVO' },
      `Acceso reactivado en ${vinculo.barberiaNombre ?? 'la sede'}.`,
    );
  }

  /**
   * I-06 · un solo camino para los tres cambios de sede. El backend ya no exige
   * `rolNombre` cuando solo cambia el estado, así que cada acción manda lo suyo
   * y nada más.
   */
  private aplicarCambioSede(
    vinculo: RolDeUsuario,
    dto: { rolNombre?: 'BARBERO' | 'ADMIN_BARBERIA'; estado?: 'ACTIVO' | 'INACTIVO' },
    mensaje: string,
  ): void {
    const usuario = this.usuarioRoles();
    if (!usuario || !vinculo.barberiaId || this.procesandoRol()) return;

    this.procesandoRol.set(true);
    this.errorRoles.set(null);

    this.service.actualizarVinculoSede(vinculo.barberiaId, usuario.id, dto).subscribe({
      next: () => {
        this.procesandoRol.set(false);
        this.avisar(mensaje);
        this.cargarRoles(usuario.id);
        this.recargar();
      },
      error: (err) => {
        this.procesandoRol.set(false);
        this.errorRoles.set(
          mensajeDeError(err, 'No se pudo actualizar el rol en la sede'),
        );
        // El select vuelve al valor real: el cambio no se aplicó.
        this.cargarRoles(usuario.id);
      },
    });
  }

  /** La columna ROLES de la tabla se alimenta del listado, no del modal. */
  private recargar(): void {
    this.service.obtenerUsuarios().subscribe({ error: () => undefined });
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
    this.toast.success(texto, 'Usuarios');
  }
}
