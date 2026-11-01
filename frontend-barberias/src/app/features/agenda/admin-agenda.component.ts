import { Component, DestroyRef, computed, inject, resource, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import {
  ESTADOS_TERMINALES,
  type EstadoReserva,
  type FiltroEstado,
  type Turno,
} from '../../core/models/turno.model';
import { FormsModule } from '@angular/forms';
import { ReservasService } from '../../core/services/reservas.service';
import { PersonalService, Personal } from '../../core/services/personal.service';
import { TenantService } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { FichaClienteDrawerComponent } from '../clientes/components/ficha-cliente-drawer/ficha-cliente-drawer.component';
import { ModalShellComponent } from '../../shared/ui/modal-shell/modal-shell.component';
import { CobroModalComponent } from './components/cobro-modal/cobro-modal.component';
import { ConfirmDialogService } from '../../shared/ui/confirm-dialog/confirm-dialog.service';

@Component({
  selector: 'app-admin-agenda',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    FichaClienteDrawerComponent,
    ModalShellComponent,
    CobroModalComponent,
  ],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-[1400px] mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header y Filtros -->
      <div class="flex flex-col gap-6 mb-8 relative z-20">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <i class="pi pi-calendar text-xs"></i>
              <span>Consola Diaria de Operaciones</span>
            </div>
            <h2 class="text-3xl font-display font-bold text-white">Consola de <span class="text-amber-400">Agenda</span></h2>
            <p class="text-sm text-zinc-400">Vista multi-columna de barberos para {{ tenantService.nombreBarberiaActiva() }}</p>
          </div>
          
          <div class="flex flex-wrap items-center gap-3">
            @if (authService.authState().user?.roles?.includes('ADMINISTRADOR') || authService.authState().user?.roles?.includes('ADMIN_BARBERIA')) {
            <button (click)="mostrarModalWalkIn.set(true)" 
                    class="px-4 py-2 rounded-xl flex items-center gap-2 font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all">
              <i class="pi pi-user-plus"></i> Walk-In
            </button>
            }

            <!-- NAVEGACIÓN RÁPIDA DE FECHA -->
            <div class="flex items-center bg-zinc-900/90 border border-zinc-700/70 rounded-xl p-1 shadow-lg">
              <button (click)="cambiarDia(-1)" class="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition-colors" title="Día anterior">
                <i class="pi pi-chevron-left text-xs"></i>
              </button>
              <button (click)="irAHoy()" class="px-2.5 py-1 text-xs font-semibold text-amber-400 hover:bg-zinc-800 rounded-md transition-colors">
                Hoy
              </button>
              <button (click)="cambiarDia(1)" class="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-amber-400 hover:bg-zinc-800 transition-colors" title="Día siguiente">
                <i class="pi pi-chevron-right text-xs"></i>
              </button>
              
              <div class="h-5 w-[1px] bg-zinc-700 mx-1"></div>
              
              <div class="flex items-center gap-2 px-2">
                <input type="date" [ngModel]="fechaFiltro()" (ngModelChange)="irAFecha($event)"
                       class="bg-transparent text-white font-medium text-xs outline-none border-none cursor-pointer">
              </div>
            </div>
          </div>
        </div>

        <!-- BARRA DE MÉTRICAS RÁPIDAS DEL DÍA -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="glass-panel p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Total Turnos</p>
              <p class="text-xl font-bold text-white mt-0.5">{{ totalTurnosDia() }}</p>
            </div>
            <div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <i class="pi pi-calendar text-sm"></i>
            </div>
          </div>

          <div class="glass-panel p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Pendientes</p>
              <p class="text-xl font-bold text-amber-400 mt-0.5">{{ pendientesDia() }}</p>
            </div>
            <div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <i class="pi pi-clock text-sm"></i>
            </div>
          </div>

          <div class="glass-panel p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Completadas</p>
              <p class="text-xl font-bold text-emerald-400 mt-0.5">{{ completadasDia() }}</p>
            </div>
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <i class="pi pi-check-circle text-sm"></i>
            </div>
          </div>

          <div class="glass-panel p-3.5 rounded-2xl border border-white/5 flex items-center justify-between">
            <div>
              <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Estimado Hoy</p>
              <p class="text-xl font-bold text-emerald-400 mt-0.5">{{ ingresosEstimadosDia() | currency:'USD':'symbol':'1.0-0' }}</p>
            </div>
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <i class="pi pi-dollar text-sm"></i>
            </div>
          </div>
        </div>

        <!-- FILTROS POR ESTADO -->
        <div class="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span class="text-zinc-500 font-medium mr-1">Filtrar:</span>
          @for (f of FILTROS_ESTADO; track f.valor) {
            <button (click)="filtroEstado.set(f.valor)"
                    class="px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap"
                    [ngClass]="filtroEstado() === f.valor
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'">
              {{ f.etiqueta }}
            </button>
          }
        </div>
      </div>

      @if (mensajeAccion()) {
        <div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2 relative z-10">
          <i class="pi pi-check-circle"></i> {{ mensajeAccion() }}
        </div>
      }

      <!-- Aviso de error al cargar o al actuar sobre una reserva -->
      @if (errorAccion()) {
        <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-start gap-2 relative z-10">
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ errorAccion() }}</span>
          <button (click)="errorAccion.set(null)" class="text-rose-300 hover:text-white transition-colors">
            <i class="pi pi-times"></i>
          </button>
        </div>
      }

      <!-- Fallo de CARGA (el de las acciones lo pinta errorAccion) -->
      @if (errorCarga()) {
        <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-start gap-2 relative z-10" role="alert">
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ errorCarga() }}</span>
          <button (click)="recargar()" class="text-rose-300 hover:text-white transition-colors" title="Reintentar">
            <i class="pi pi-refresh"></i>
          </button>
        </div>
      }

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
                         'border-amber-500': turno.estado === 'PENDIENTE' && turno.cliente.contadorNoPresentado < 3,
                         'border-red-500 bg-red-950/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]': turno.estado === 'PENDIENTE' && turno.cliente.contadorNoPresentado >= 3,
                         'border-emerald-500 opacity-60': turno.estado === 'COMPLETADA',
                         'border-red-500 opacity-50': turno.estado === 'CANCELADA' || turno.estado === 'NO_ASISTIO'
                       }">
                    
                    <div class="flex justify-between items-start">
                      <div class="flex items-center gap-2">
                        <span class="text-lg font-bold text-white tracking-tight">{{ turno.fechaHoraInicio | date:'HH:mm' }}</span>
                        <span class="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-zinc-800"
                              [ngClass]="claseEstadoTurno(turno.estado)">
                          {{ etiquetaEstado(turno.estado) }}
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
                          @if (turno.cliente.contadorNoPresentado >= 3) {
                            <i class="pi pi-exclamation-triangle text-red-500 animate-pulse" 
                               [title]="'Advertencia: Cliente con ' + turno.cliente.contadorNoPresentado + ' inasistencias previas'"></i>
                          }
                          @if (turno.cliente.estaRestringido) {
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
                    <div class="flex flex-wrap items-center justify-end gap-2 pt-2 mt-2 border-t border-white/5">
                      @if (esPendiente(turno.estado) && puedeGestionarSede()) {
                        <button (click)="confirmarTurno(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi" [ngClass]="procesandoId() === turno.id ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                          Confirmar
                        </button>
                      }

                      <!--
                        E3-09 · el cobro es CONFIRMADA → COMPLETADA para el actor
                        STAFF (ReservaStateMachine.assertTransition) y además exige
                        ahora >= hora_inicio. Antes el botón se pintaba en PENDIENTE:
                        el backend respondía 409 ESTADO_INVALIDO y, tras confirmar la
                        cita, la caja se quedaba sin ninguna entrada al cobro. El
                        botón sigue al estado que el backend acepta.
                      -->
                      @if (turno.estado === 'CONFIRMADA') {
                        <button (click)="iniciarCobro(turno)"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5">
                          <i class="pi pi-wallet"></i> Cobrar
                        </button>
                      }

                      <!-- E2-02: el no presentado de §5.2 solo existe desde CONFIRMADA
                           (la sede RECHAZA una PENDIENTE); antes el botón aparecía en
                           PENDIENTE y el backend lo aceptaba desde cualquier estado. -->
                      @if (turno.estado === 'CONFIRMADA' && puedeMarcarInasistencia()) {
                        <button (click)="marcarInasistencia(turno.id)" class="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                          No Asistió
                        </button>
                      }

                      <!-- V3 · el turno «Sin Asignar» ya se puede resolver sin cancelar y recrear
                           la cita: el modal elige un barbero de la sede y el backend revalida
                           que esté libre en ese rango. -->
                      @if (puedeAsignar(turno) && puedeGestionarSede()) {
                        <button (click)="abrirAsignacion(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi pi-user-edit"></i>
                          {{ turno.barbero ? 'Reasignar' : 'Asignar Barbero' }}
                        </button>
                      }

                      @if (puedeCancelar(turno.estado) && puedeGestionarSede()) {
                        <button (click)="cancelarTurno(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-rose-500/40 hover:text-rose-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi pi-times"></i> Cancelar
                        </button>
                      }
                    </div>
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
                  <!-- Igual que la columna del barbero, pero sin barbero asignado -->
                  <div class="bg-zinc-900/80 p-4 rounded-2xl border-l-4 border-zinc-500 flex flex-col gap-2">
                    <div class="flex justify-between items-start">
                      <span class="text-lg font-bold text-white tracking-tight">{{ turno.fechaHoraInicio | date:'HH:mm' }}</span>
                      <span class="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-zinc-800"
                            [ngClass]="claseEstadoTurno(turno.estado)">
                        {{ etiquetaEstado(turno.estado) }}
                      </span>
                    </div>
                    <div class="text-sm text-zinc-300 font-medium flex items-center justify-between gap-2">
                      <span>{{ turno.cliente.nombre }}</span>
                      <span class="text-sm font-bold text-emerald-400">
                        {{ turno.precioTotalHist | currency:'USD':'symbol':'1.0-0' }}
                      </span>
                    </div>
                    <p class="text-[11px] text-zinc-500 flex items-center gap-1.5">
                      <i class="pi pi-info-circle"></i>
                      Sin barbero asignado · confirma o cancela el turno
                    </p>

                    <div class="flex flex-wrap items-center justify-end gap-2 pt-2 mt-1 border-t border-white/5">
                      @if (esPendiente(turno.estado) && puedeGestionarSede()) {
                        <button (click)="confirmarTurno(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi" [ngClass]="procesandoId() === turno.id ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                          Confirmar
                        </button>
                      }
                      <!-- V3 · el turno «Sin Asignar» ya se puede resolver sin cancelar y recrear
                           la cita: el modal elige un barbero de la sede y el backend revalida
                           que esté libre en ese rango. -->
                      @if (puedeAsignar(turno) && puedeGestionarSede()) {
                        <button (click)="abrirAsignacion(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi pi-user-edit"></i>
                          {{ turno.barbero ? 'Reasignar' : 'Asignar Barbero' }}
                        </button>
                      }

                      @if (puedeCancelar(turno.estado) && puedeGestionarSede()) {
                        <button (click)="cancelarTurno(turno)"
                                [disabled]="procesandoId() === turno.id"
                                class="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-rose-500/40 hover:text-rose-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                          <i class="pi pi-times"></i> Cancelar
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }

        </div>
      }

      <!-- V3 · Modal de asignación de barbero -->
      @if (turnoAAsignar(); as turno) {
        <app-modal-shell
          [visible]="true"
          titulo="Asignar Barbero"
          [subtitulo]="turno.cliente.nombre + ' · ' + (turno.fechaHoraInicio | date: 'HH:mm')"
          icono="pi pi-user-edit"
          [cerrarBloqueado]="asignando()"
          (cerrar)="cerrarAsignacion()">
          @if (errorAsignacion()) {
            <div class="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start gap-2" role="alert">
              <i class="pi pi-exclamation-triangle mt-0.5"></i>
              <span>{{ errorAsignacion() }}</span>
            </div>
          }

          <div class="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
            @for (miembro of staffAsignable(); track miembro.id) {
              <button (click)="barberoDestino.set(miembro.id)"
                      class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left"
                      [ngClass]="barberoDestino() === miembro.id ? 'border-amber-500/60 bg-amber-500/10' : 'border-white/5 bg-zinc-900/60 hover:bg-zinc-800/70'">
                <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/25 to-amber-600/25 border border-amber-500/30 flex items-center justify-center text-amber-300 text-xs font-bold">
                  {{ miembro.nombreCompleto.charAt(0).toUpperCase() }}
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-semibold text-zinc-100 truncate">{{ miembro.nombreCompleto }}</span>
                  <span class="block text-[10px] text-zinc-500">{{ miembro.roles.join(' · ') }}</span>
                </span>
                @if (miembro.id === turno.barbero?.id) {
                  <span class="text-[9px] uppercase tracking-wider font-bold text-emerald-400">Actual</span>
                }
                @if (barberoDestino() === miembro.id) {
                  <i class="pi pi-check-circle text-amber-400"></i>
                }
              </button>
            } @empty {
              <p class="text-xs text-zinc-500 text-center py-6">
                No hay barberos activos en esta sede.
              </p>
            }
          </div>

          <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
            <button (click)="cerrarAsignacion()" class="flex-1 py-3 rounded-xl font-medium text-sm text-zinc-300 bg-white/5 hover:bg-white/10 transition-colors">
              Cancelar
            </button>
            <button (click)="confirmarAsignacion()" [disabled]="!barberoDestino() || asignando()"
                    class="flex-1 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              @if (asignando()) {
                <i class="pi pi-spin pi-spinner"></i> Asignando...
              } @else {
                <i class="pi pi-check"></i> Asignar
              }
            </button>
          </div>
        </app-modal-shell>
      }

      <!-- V3 fase 6 · Modal de Cobro: método de pago + total de la reserva.
           Al cerrar con éxito la tarjeta se recarga la agenda y el turno pasa a
           COMPLETADA en su columna. -->
      @if (turnoACobrar(); as turno) {
        <app-cobro-modal
          [reserva]="turno"
          (cobrado)="onCobroExitoso()"
          (cerrar)="turnoACobrar.set(null)"
        />
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
export class AdminAgendaComponent {
  protected readonly reservasService = inject(ReservasService);
  protected readonly personalService = inject(PersonalService);
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  private readonly destroyRef = inject(DestroyRef);

  /**
   * Fase 4 · la fecha es un SIGNAL: es la única entrada de la agenda y el
   * recurso la observa. Antes cada cambio de día llamaba a un `cargarDatos()`
   * que anidaba dos `.subscribe()`; ahora basta con `set()` y la lectura (y la
   * cancelación de la anterior si el usuario cambia de día rápido) las gestiona
   * el recurso.
   */
  readonly fechaFiltro = signal(new Date().toISOString().split('T')[0]);

  /**
   * Lectura de la agenda. `resource` reemplaza al `.subscribe()` de montaje: el
   * valor llega como señal, `isLoading()` y `error()` los da Angular y el
   * `abortSignal` del loader corta la petición anterior si la fecha cambia antes
   * de que responda. Con el subscribe manual las respuestas podían llegar en
   * desorden y dejar pintado un día que ya no era el elegido.
   */
  private readonly agendaResource = resource({
    params: () => ({
      fecha: this.fechaFiltro(),
      barberiaId: this.tenantService.barberiaActivaId(),
    }),
    loader: ({ params }) =>
      params.barberiaId && params.fecha
        ? firstValueFrom(this.reservasService.obtenerAgendaDiaria(params.fecha))
        : Promise.resolve([] as Turno[]),
  });

  /** Equipo de la sede: barberos y admins asignables. Independiente de la fecha. */
  private readonly equipoResource = resource({
    params: () => ({ barberiaId: this.tenantService.barberiaActivaId() }),
    loader: ({ params }) =>
      params.barberiaId
        ? firstValueFrom(this.personalService.obtenerPersonal(params.barberiaId))
        : Promise.resolve([] as Personal[]),
  });

  readonly turnos = computed<Turno[]>(() => this.agendaResource.value() ?? []);

  /**
   * El backend acepta BARBERO o ADMIN_BARBERIA como destino de una reasignación,
   * pero las cuentas no ACTIVAS se dejan fuera: `asignarBarbero` responde 422
   * `BARBERO_INACTIVO` y ofrecerlas sería pintar un error garantizado.
   */
  readonly staffAsignable = computed<Personal[]>(() =>
    (this.equipoResource.value() ?? []).filter(
      (p) =>
        p.estado === 'ACTIVO' &&
        (p.roles.includes('BARBERO') || p.roles.includes('ADMIN_BARBERIA')),
    ),
  );

  /** Columnas de la agenda: los barberos de la sede (o todo el equipo si no hay). */
  readonly barberos = computed<Personal[]>(() => {
    const equipo = this.equipoResource.value() ?? [];
    const soloBarberos = equipo.filter((p) => p.roles.includes('BARBERO'));
    return soloBarberos.length > 0 ? soloBarberos : equipo;
  });

  readonly cargando = computed(
    () => this.agendaResource.isLoading() || this.equipoResource.isLoading(),
  );

  /** Fallo de CARGA (las acciones tienen su propio `errorAccion`). */
  readonly errorCarga = computed<string | null>(() => {
    const error = this.agendaResource.error() ?? this.equipoResource.error();
    if (!error) return null;
    const cuerpo = error as { error?: { mensaje?: string; message?: string } };
    return (
      cuerpo?.error?.mensaje ?? cuerpo?.error?.message ?? 'No se pudo cargar la agenda del día.'
    );
  });

  mostrarModalWalkIn = signal(false);
  filtroEstado = signal<FiltroEstado>('TODOS');

  turnoACobrar = signal<Turno | null>(null);

  /** V3 · turno cuyo barbero se está asignando, destino elegido y su estado. */
  readonly turnoAAsignar = signal<Turno | null>(null);
  readonly barberoDestino = signal<string | null>(null);
  readonly asignando = signal(false);
  readonly errorAsignacion = signal<string | null>(null);
  clienteSeleccionado = signal<{ id: string; nombre: string } | null>(null);

  /** Id del turno con una acción en vuelo, para bloquear solo esa tarjeta. */
  procesandoId = signal<string | null>(null);
  errorAccion = signal<string | null>(null);
  mensajeAccion = signal<string | null>(null);

  readonly FILTROS_ESTADO: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'TODOS', etiqueta: 'Todos los turnos' },
    { valor: 'PENDIENTE', etiqueta: 'Pendientes' },
    { valor: 'CONFIRMADA', etiqueta: 'Confirmadas' },
    { valor: 'COMPLETADA', etiqueta: 'Completadas' },
    { valor: 'CANCELADA', etiqueta: 'Canceladas' },
  ];

  /** Aceptar y cancelar son decisiones de la SEDE (D02), no del barbero. */
  puedeGestionarSede = computed(() => {
    const roles = this.authService.authState().user?.roles ?? [];
    return roles.includes('ADMIN_BARBERIA') || roles.includes('ADMINISTRADOR');
  });

  // E1-05 · D02: el no presentado (`POST /reservas/:id/inasistencia` desde
  // E2-02) es del ADMIN_BARBERIA y del ADMINISTRADOR global, así que el barbero
  // no ve el botón «No Asistió» (la pantalla le deja cobrar y registrar el
  // walk-in, que sí puede).
  puedeMarcarInasistencia = computed(() => {
    const roles = this.authService.authState().user?.roles ?? [];
    return !roles.includes('BARBERO') || roles.includes('ADMIN_BARBERIA') || roles.includes('ADMINISTRADOR');
  });

  /**
   * Métricas del día. Se calculan sobre TODA la agenda (`turnos`), que ya
   * incluye los turnos sin barbero: la columna «Sin Asignar» es la misma lista
   * filtrada, no una fuente aparte. Antes el KPI se leía como contradictorio
   * porque la tarjeta de «Sin Asignar» pintaba `PENDIENTE` fijo aunque el turno
   * estuviera en otro estado; ahora la tarjeta muestra el estado real.
   */
  totalTurnosDia = computed(() => this.turnos().length);
  pendientesDia = computed(() => this.turnos().filter(t => this.esPendiente(t.estado)).length);
  completadasDia = computed(() => this.turnos().filter(t => t.estado === 'COMPLETADA').length);
  ingresosEstimadosDia = computed(() => {
    return this.turnos()
      .filter(t => t.estado === 'COMPLETADA' || t.estado === 'PENDIENTE' || t.estado === 'CONFIRMADA')
      .reduce((acc, t) => acc + (Number(t.precioTotalHist) || 0), 0);
  });

  /** Elegir una fecha en el calendario: el recurso recarga por su cuenta. */
  irAFecha(fecha: string): void {
    if (!fecha) return;
    this.fechaFiltro.set(fecha);
  }

  cambiarDia(delta: number) {
    const d = new Date(this.fechaFiltro() + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    this.fechaFiltro.set(d.toISOString().split('T')[0]);
  }

  irAHoy() {
    this.fechaFiltro.set(new Date().toISOString().split('T')[0]);
  }

  /**
   * Fase 4 · refresco EXPLÍCITO tras una acción del usuario (confirmar, cobrar,
   * asignar…). No es una lectura de montaje: el estado ya cambió en el backend y
   * hay que volver a pedirlo. Los dos recursos se recargan a la vez.
   */
  private recargar(): void {
    this.errorAccion.set(null);
    this.agendaResource.reload();
    this.equipoResource.reload();
  }

  /** `PROPUESTA_PENDIENTE` también espera una decisión de la sede. */
  esPendiente(estado: EstadoReserva | undefined): boolean {
    return estado === 'PENDIENTE' || estado === 'PROPUESTA_PENDIENTE';
  }

  /** Estados terminales: ya no se pueden cancelar ni confirmar. */
  puedeCancelar(estado: EstadoReserva | undefined): boolean {
    return !!estado && !ESTADOS_TERMINALES.includes(estado);
  }

  etiquetaEstado(estado: EstadoReserva | undefined): string {
    return (estado || 'SIN ESTADO').replace(/_/g, ' ');
  }

  claseEstadoTurno(estado: EstadoReserva | undefined): Record<string, boolean> {
    return {
      'text-amber-400': this.esPendiente(estado),
      'text-sky-400': estado === 'CONFIRMADA',
      'text-emerald-400': estado === 'COMPLETADA',
      'text-red-400':
        estado === 'CANCELADA' ||
        estado === 'RECHAZADA' ||
        estado === 'EXPIRADA' ||
        estado === 'NO_PRESENTADO' ||
        estado === 'NO_ASISTIO',
    };
  }

  async confirmarTurno(turno: Turno): Promise<void> {
    const hora = new Date(turno.fechaHoraInicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Confirmar turno',
      mensaje: `¿Confirmar el turno de ${turno.cliente?.nombre ?? 'este cliente'} a las ${hora}?`,
      textoConfirmar: 'Sí, confirmar',
      icono: 'pi pi-check-circle',
    });
    if (!confirmado) return;

    this.procesandoId.set(turno.id);
    this.errorAccion.set(null);
    this.reservasService
      .aceptarReserva(turno.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.mensajeAccion.set('Turno confirmado correctamente.');
        setTimeout(() => this.mensajeAccion.set(null), 4000);
        this.recargar();
      },
      error: (err) => {
        this.procesandoId.set(null);
        this.errorAccion.set(
          err?.error?.mensaje || err?.error?.message || 'No se pudo confirmar el turno.',
        );
      },
    });
  }

  async cancelarTurno(turno: Turno): Promise<void> {
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Cancelar turno',
      mensaje: `¿Cancelar el turno de ${turno.cliente?.nombre ?? 'este cliente'}? La cita dejará de ocupar la agenda y la franja quedará libre para otro cliente.`,
      textoConfirmar: 'Sí, cancelar',
      tono: 'peligro',
      icono: 'pi pi-calendar-minus',
    });
    if (!confirmado) return;

    this.procesandoId.set(turno.id);
    this.errorAccion.set(null);
    this.reservasService
      .cancelarReserva(turno.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.mensajeAccion.set('Turno cancelado. La franja quedó liberada.');
        setTimeout(() => this.mensajeAccion.set(null), 4000);
        this.recargar();
      },
      error: (err) => {
        this.procesandoId.set(null);
        this.errorAccion.set(
          err?.error?.mensaje || err?.error?.message || 'No se pudo cancelar el turno.',
        );
      },
    });
  }

  turnosPorBarbero(barberoId: string) {
    return this.turnos()
      .filter(t => {
        const matchesBarbero = t.barbero?.id === barberoId;
        if (!matchesBarbero) return false;
        if (this.filtroEstado() === 'TODOS') return true;
        return t.estado === this.filtroEstado();
      })
      .sort((a, b) => new Date(a.fechaHoraInicio).getTime() - new Date(b.fechaHoraInicio).getTime());
  }

  turnosSinAsignar() {
    return this.turnos()
      .filter(t => {
        const sinAsignar = !t.barbero || !t.barbero.id;
        if (!sinAsignar) return false;
        if (this.filtroEstado() === 'TODOS') return true;
        return t.estado === this.filtroEstado();
      })
      .sort((a, b) => new Date(a.fechaHoraInicio).getTime() - new Date(b.fechaHoraInicio).getTime());
  }

  /**
   * E2-02: `PATCH /reservas/:id/estado` ya no existe. El no presentado tiene su
   * ruta dedicada y solo se admite desde `CONFIRMADA` (§5.2).
   */
  async marcarInasistencia(id: string): Promise<void> {
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Marcar inasistencia',
      mensaje:
        '¿Confirmas que el cliente no se presentó a este turno? La cita quedará como no presentada y no podrá volver a confirmarse.',
      textoConfirmar: 'Sí, no se presentó',
      tono: 'peligro',
      icono: 'pi pi-user-minus',
    });
    if (!confirmado) return;

    // Fase 4 · `takeUntilDestroyed` corta la petición si el usuario cambia de
    // pantalla antes de que responda; el error ya no se traga en silencio.
    this.reservasService
      .marcarInasistencia(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mensajeAccion.set('Turno marcado como no presentado.');
          setTimeout(() => this.mensajeAccion.set(null), 4000);
          this.recargar();
        },
        error: (err) =>
          this.errorAccion.set(
            err?.error?.mensaje || err?.error?.message || 'No se pudo marcar la inasistencia.',
          ),
      });
  }

  /**
   * V3 · solo se reasigna una reserva viva. Los estados terminales los rechaza
   * el backend con 409 `ESTADO_INVALIDO`; aquí ni siquiera se ofrece el botón.
   */
  puedeAsignar(turno: Turno | null): boolean {
    if (!turno) return false;
    return ['PENDIENTE', 'PROPUESTA_PENDIENTE', 'CONFIRMADA'].includes(turno.estado);
  }

  abrirAsignacion(turno: Turno): void {
    if (!this.puedeGestionarSede()) return;
    this.errorAsignacion.set(null);
    this.barberoDestino.set(null);
    this.turnoAAsignar.set(turno);
  }

  cerrarAsignacion(): void {
    this.turnoAAsignar.set(null);
    this.barberoDestino.set(null);
    this.errorAsignacion.set(null);
  }

  /**
   * Al confirmar se recarga la agenda: la tarjeta se mueve sola a la columna del
   * barbero porque `turnosPorBarbero` filtra por `turno.barbero.id` y el backend
   * ya devuelve el barbero nuevo en la lista del día.
   */
  confirmarAsignacion(): void {
    const turno = this.turnoAAsignar();
    const destino = this.barberoDestino();
    if (!turno || !destino || this.asignando()) return;

    this.asignando.set(true);
    this.errorAsignacion.set(null);

    this.reservasService
      .asignarBarbero(turno.id, destino)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (resultado) => {
        this.asignando.set(false);
        this.cerrarAsignacion();
        this.mensajeAccion.set(`Turno asignado a ${resultado?.barbero?.nombre ?? 'el barbero'}.`);
        setTimeout(() => this.mensajeAccion.set(null), 4000);
        this.recargar();
      },
      error: (err) => {
        this.asignando.set(false);
        // 403 (otra sede) y 409 (barbero ocupado o bloqueado) llegan con el
        // mensaje D40 del backend; se muestran tal cual en el modal.
        this.errorAsignacion.set(
          err?.error?.mensaje || err?.error?.message || 'No se pudo asignar el barbero.',
        );
      },
    });
  }

  iniciarCobro(turno: Turno) {
    this.turnoACobrar.set(turno);
  }

  onCobroExitoso() {
    this.turnoACobrar.set(null);
    this.mensajeAccion.set('Cobro registrado: la cita quedó COMPLETADA.');
    setTimeout(() => this.mensajeAccion.set(null), 4000);
    this.recargar();
  }

  abrirFicha(cliente: { id: string; nombre: string } | null | undefined) {
    if (!cliente) return;
    this.clienteSeleccionado.set(cliente);
  }

  onWalkInCreado() {
    this.mostrarModalWalkIn.set(false);
    this.recargar();
  }
}
