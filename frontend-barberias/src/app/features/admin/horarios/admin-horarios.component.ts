import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HorariosService, Horario, ExcepcionHorario, BloqueoAgenda, CreateBloqueoDto } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';

interface DiaConfig {
  dia: number;
  nombre: string;
  activo: boolean;
  horaInicio: string;
  horaFin: string;
}

type TabActiva = 'semanal' | 'excepciones' | 'bloqueos';

@Component({
  selector: 'app-admin-horarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-8 pb-12 animate-fade-in relative z-10">
      
      <!-- ENCABEZADO -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 relative">
        <div class="space-y-1">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-sliders-h text-xs"></i>
            <span>Control de Disponibilidad</span>
          </div>
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight drop-shadow-md">
            Horarios y <span class="text-amber-400">Excepciones</span>
          </h2>
          <p class="text-zinc-400 text-sm sm:text-base">
            Gestiona la operación semanal regular, cierres por feriados y bloqueos temporales de agenda.
          </p>
        </div>
        
        @if (tabActiva() === 'semanal') {
          <button (click)="guardarHorarios()"
                  [disabled]="guardando()"
                  class="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_5px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_10px_30px_rgba(212,175,55,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
            <i class="pi" [ngClass]="guardando() ? 'pi-spin pi-spinner' : 'pi-save'"></i>
            <span>{{ guardando() ? 'Guardando...' : 'Guardar Horario Semanal' }}</span>
          </button>
        } @else if (tabActiva() === 'excepciones') {
          <button (click)="abrirModalExcepcion()"
                  class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_5px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_10px_30px_rgba(212,175,55,0.4)] transition-all flex items-center gap-2">
            <i class="pi pi-plus"></i>
            <span>Nueva Excepción</span>
          </button>
        } @else if (tabActiva() === 'bloqueos') {
          <button (click)="abrirModalBloqueo()"
                  class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_5px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_10px_30px_rgba(212,175,55,0.4)] transition-all flex items-center gap-2">
            <i class="pi pi-lock"></i>
            <span>Crear Bloqueo Temporal</span>
          </button>
        }
      </div>

      <!-- NOTIFICACIONES FEEDBACK -->
      @if (mensajeExito()) {
        <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2 animate-in fade-in">
          <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
        </div>
      }
      @if (mensajeError()) {
        <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2 animate-in fade-in">
          <i class="pi pi-exclamation-triangle"></i> {{ mensajeError() }}
        </div>
      }

      <!-- TABS DE NAVEGACIÓN -->
      <div class="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <button (click)="cambiarTab('semanal')"
                class="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2"
                [ngClass]="tabActiva() === 'semanal' 
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/10' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent'">
          <i class="pi pi-calendar"></i>
          <span>Horario Regular (Semanal)</span>
        </button>

        <button (click)="cambiarTab('excepciones')"
                class="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 relative"
                [ngClass]="tabActiva() === 'excepciones' 
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/10' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent'">
          <i class="pi pi-calendar-times"></i>
          <span>Excepciones y Feriados</span>
          @if (excepciones().length > 0) {
            <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400/20 text-amber-300 font-bold ml-1">
              {{ excepciones().length }}
            </span>
          }
        </button>

        <button (click)="cambiarTab('bloqueos')"
                class="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 relative"
                [ngClass]="tabActiva() === 'bloqueos' 
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/10' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent'">
          <i class="pi pi-lock"></i>
          <span>Bloqueos de Agenda</span>
          @if (bloqueos().length > 0) {
            <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400/20 text-amber-300 font-bold ml-1">
              {{ bloqueos().length }}
            </span>
          }
        </button>
      </div>

      <!-- ================= TAB 1: HORARIOS SEMANALES ================= -->
      @if (tabActiva() === 'semanal') {
        <div class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-white/5">
            <div>
              <h3 class="text-base font-semibold text-white">Días de Atención al Público</h3>
              <p class="text-xs text-zinc-400">Activa o desactiva días y configura rangos de apertura y cierre.</p>
            </div>
            <span class="text-xs text-zinc-500">Formato 24 horas</span>
          </div>
          
          <div class="hidden md:grid grid-cols-12 gap-4 pb-2 pt-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            <div class="col-span-4">Día de la Semana</div>
            <div class="col-span-4">Apertura (HH:mm)</div>
            <div class="col-span-4">Cierre (HH:mm)</div>
          </div>

          <div class="space-y-3 md:space-y-2">
            @for (dia of diasConfig; track dia.dia) {
              <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-3.5 md:p-3 rounded-2xl transition-all"
                   [ngClass]="dia.activo ? 'bg-zinc-900/60 border border-zinc-700/60 hover:border-amber-500/30' : 'bg-zinc-950/40 border border-white/5 opacity-50'">
                
                <div class="col-span-1 md:col-span-4 flex items-center gap-3">
                  <button (click)="toggleDia(dia)" 
                          class="w-11 h-6 rounded-full flex items-center p-1 transition-colors duration-300 focus:outline-none"
                          [ngClass]="dia.activo ? 'bg-amber-500' : 'bg-zinc-700'">
                    <div class="w-4 h-4 rounded-full bg-white transform transition-transform duration-300 shadow-sm"
                         [ngClass]="dia.activo ? 'translate-x-5' : 'translate-x-0'"></div>
                  </button>
                  <span class="font-medium text-white text-sm">{{ dia.nombre }}</span>
                  @if (!dia.activo) {
                    <span class="text-[11px] font-medium text-rose-400 bg-rose-400/10 px-2 py-0.5 rounded-full ml-1">Cerrado</span>
                  }
                </div>

                <div class="col-span-1 md:col-span-4 flex flex-col md:block">
                  <label class="md:hidden text-xs text-zinc-500 mb-1">Apertura</label>
                  <input type="time" [(ngModel)]="dia.horaInicio" [disabled]="!dia.activo"
                         class="w-full bg-zinc-950/70 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40">
                </div>

                <div class="col-span-1 md:col-span-4 flex flex-col md:block">
                  <label class="md:hidden text-xs text-zinc-500 mb-1">Cierre</label>
                  <input type="time" [(ngModel)]="dia.horaFin" [disabled]="!dia.activo"
                         class="w-full bg-zinc-950/70 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40">
                </div>

              </div>
            }
          </div>
        </div>
      }

      <!-- ================= TAB 2: EXCEPCIONES DE HORARIO ================= -->
      @if (tabActiva() === 'excepciones') {
        <div class="space-y-6">
          <div class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
            <div class="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <h3 class="text-base font-semibold text-white">Días Excepcionales Registrados</h3>
                <p class="text-xs text-zinc-400">Feriados nacionales, festividades o días con jornada reducida.</p>
              </div>
              <button (click)="cargarExcepciones()" class="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
                <i class="pi pi-refresh" [ngClass]="cargandoExcepciones() ? 'pi-spin' : ''"></i> Actualizar
              </button>
            </div>

            @if (cargandoExcepciones()) {
              <div class="py-12 text-center text-zinc-500">
                <i class="pi pi-spin pi-spinner text-2xl text-amber-400 mb-2 block"></i>
                Cargando excepciones...
              </div>
            } @else if (excepciones().length === 0) {
              <div class="py-12 text-center text-zinc-500 space-y-3">
                <div class="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
                  <i class="pi pi-calendar-times text-xl"></i>
                </div>
                <div>
                  <p class="text-sm font-medium text-zinc-300">No hay excepciones configuradas</p>
                  <p class="text-xs text-zinc-500 mt-1">Registra días festivos o cierres programados para que los clientes no puedan reservar en esas fechas.</p>
                </div>
                <button (click)="abrirModalExcepcion()"
                        class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all">
                  + Registrar Primera Excepción
                </button>
              </div>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th class="py-3 px-4">Fecha</th>
                      <th class="py-3 px-4">Tipo</th>
                      <th class="py-3 px-4">Horario</th>
                      <th class="py-3 px-4">Motivo / Descripción</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-800/60 text-zinc-300">
                    @for (exc of excepciones(); track exc.id || exc.fecha) {
                      <tr class="hover:bg-zinc-900/40 transition-colors">
                        <td class="py-3.5 px-4 font-mono text-white font-medium">
                          {{ formatearFecha(exc.fecha) }}
                        </td>
                        <td class="py-3.5 px-4">
                          @if (exc.tipo === 'CERRADA') {
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400">
                              <i class="pi pi-times-circle text-[10px]"></i> Sede Cerrada
                            </span>
                          } @else {
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                              <i class="pi pi-clock text-[10px]"></i> Horario Especial
                            </span>
                          }
                        </td>
                        <td class="py-3.5 px-4 text-zinc-300">
                          @if (exc.tipo === 'HORARIO_ESPECIAL') {
                            <span class="font-medium text-amber-300">{{ exc.horaInicio }} - {{ exc.horaFin }}</span>
                          } @else {
                            <span class="text-zinc-500">Todo el día</span>
                          }
                        </td>
                        <td class="py-3.5 px-4 text-zinc-400">
                          {{ exc.motivo || 'Sin descripción' }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }

      <!-- ================= TAB 3: BLOQUEOS DE AGENDA ================= -->
      @if (tabActiva() === 'bloqueos') {
        <div class="space-y-6">
          <div class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
            <div class="flex items-center justify-between pb-3 border-b border-white/5">
              <div>
                <h3 class="text-base font-semibold text-white">Bloqueos Temporales Activos</h3>
                <p class="text-xs text-zinc-400">Franjas horarias bloqueadas temporalmente para evitar reservas automáticas.</p>
              </div>
              <button (click)="cargarBloqueos()" class="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
                <i class="pi pi-refresh" [ngClass]="cargandoBloqueos() ? 'pi-spin' : ''"></i> Actualizar
              </button>
            </div>

            @if (cargandoBloqueos()) {
              <div class="py-12 text-center text-zinc-500">
                <i class="pi pi-spin pi-spinner text-2xl text-amber-400 mb-2 block"></i>
                Cargando bloqueos...
              </div>
            } @else if (bloqueos().length === 0) {
              <div class="py-12 text-center text-zinc-500 space-y-3">
                <div class="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
                  <i class="pi pi-lock text-xl"></i>
                </div>
                <div>
                  <p class="text-sm font-medium text-zinc-300">No hay bloqueos activos</p>
                  <p class="text-xs text-zinc-500 mt-1">Crea bloqueos puntuales para reuniones de equipo, reparaciones o almuerzos imprevistos.</p>
                </div>
                <button (click)="abrirModalBloqueo()"
                        class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all">
                  + Crear Bloqueo de Franja
                </button>
              </div>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                  <thead class="text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th class="py-3 px-4">Fecha</th>
                      <th class="py-3 px-4">Horario</th>
                      <th class="py-3 px-4">Motivo</th>
                      <th class="py-3 px-4">Liberación Auto</th>
                      <th class="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-800/60 text-zinc-300">
                    @for (b of bloqueos(); track b.id) {
                      <tr class="hover:bg-zinc-900/40 transition-colors">
                        <td class="py-3.5 px-4 font-mono text-white font-medium">
                          {{ formatearFecha(b.fecha) }}
                        </td>
                        <td class="py-3.5 px-4">
                          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-zinc-800 border border-zinc-700 text-amber-400">
                            <i class="pi pi-clock text-[10px]"></i>
                            {{ b.horaInicio }} - {{ b.horaFin }}
                          </span>
                        </td>
                        <td class="py-3.5 px-4 text-zinc-300">
                          {{ b.motivo || 'Bloqueo manual' }}
                        </td>
                        <td class="py-3.5 px-4">
                          @if (b.jobId) {
                            <span class="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <i class="pi pi-bolt text-[9px]"></i> BullMQ Auto
                            </span>
                          } @else {
                            <span class="text-zinc-500 text-[11px]">Manual</span>
                          }
                        </td>
                        <td class="py-3.5 px-4 text-right">
                          <button (click)="eliminarBloqueo(b.id)"
                                  class="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 transition-all"
                                  title="Eliminar bloqueo">
                            <i class="pi pi-trash text-sm"></i>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }

      <!-- ================= MODAL NUEVA EXCEPCIÓN ================= -->
      @if (modalExcepcionAbierto()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div class="bg-zinc-900 border border-amber-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-6">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-xl font-bold text-white">Nueva Excepción de Horario</h3>
                  <p class="text-xs text-zinc-400">Feriados, días festivos o jornada especial</p>
                </div>
                <button (click)="cerrarModalExcepcion()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Fecha</label>
                  <input type="date" [(ngModel)]="excepcionModel.fecha"
                         class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Tipo de Excepción</label>
                  <select [(ngModel)]="excepcionModel.tipo"
                          class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="CERRADA">Sede Cerrada (Todo el día no laborable)</option>
                    <option value="HORARIO_ESPECIAL">Horario Especial (Apertura y Cierre personalizado)</option>
                  </select>
                </div>

                @if (excepcionModel.tipo === 'HORARIO_ESPECIAL') {
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Inicio</label>
                      <input type="time" [(ngModel)]="excepcionModel.horaInicio"
                             class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Fin</label>
                      <input type="time" [(ngModel)]="excepcionModel.horaFin"
                             class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                    </div>
                  </div>
                }

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo o Justificación</label>
                  <input type="text" [(ngModel)]="excepcionModel.motivo" placeholder="Ej. Navidad, Año Nuevo, Fumigación..."
                         class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                </div>
              </div>

              <div class="flex gap-3 pt-4 border-t border-zinc-800">
                <button (click)="cerrarModalExcepcion()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="guardarExcepcion()"
                        [disabled]="guardandoExcepcion()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                  <i class="pi" [ngClass]="guardandoExcepcion() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                  <span>{{ guardandoExcepcion() ? 'Guardando...' : 'Guardar Excepción' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- ================= MODAL NUEVO BLOQUEO ================= -->
      @if (modalBloqueoAbierto()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div class="bg-zinc-900 border border-amber-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-6">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-xl font-bold text-white">Nuevo Bloqueo de Franja</h3>
                  <p class="text-xs text-zinc-400">Bloquea turnos temporales en la agenda</p>
                </div>
                <button (click)="cerrarModalBloqueo()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Fecha</label>
                  <input type="date" [(ngModel)]="bloqueoModel.fecha"
                         class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Inicio</label>
                    <input type="time" [(ngModel)]="bloqueoModel.horaInicio"
                           class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Fin</label>
                    <input type="time" [(ngModel)]="bloqueoModel.horaFin"
                           class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo</label>
                  <input type="text" [(ngModel)]="bloqueoModel.motivo" placeholder="Ej. Almuerzo general, Reparación de equipos..."
                         class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                </div>

                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Auto-liberación (BullMQ)</label>
                  <select [(ngModel)]="bloqueoModel.liberacionAutomaticaMinutos"
                          class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
                    <option [ngValue]="undefined">Manual (Hasta que se elimine)</option>
                    <option [ngValue]="15">Liberar en 15 minutos</option>
                    <option [ngValue]="30">Liberar en 30 minutos</option>
                    <option [ngValue]="60">Liberar en 1 hora</option>
                    <option [ngValue]="120">Liberar en 2 horas</option>
                  </select>
                </div>
              </div>

              <div class="flex gap-3 pt-4 border-t border-zinc-800">
                <button (click)="cerrarModalBloqueo()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="guardarBloqueo()"
                        [disabled]="guardandoBloqueo()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                  <i class="pi" [ngClass]="guardandoBloqueo() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                  <span>{{ guardandoBloqueo() ? 'Creando...' : 'Crear Bloqueo' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }

    </div>
  `
})
export class AdminHorariosComponent implements OnInit {
  private tenantService = inject(TenantService);
  private horariosService = inject(HorariosService);

  // Pestaña activa
  tabActiva = signal<TabActiva>('semanal');

  // Estados generales
  guardando = signal(false);
  mensajeExito = signal('');
  mensajeError = signal('');

  // Tab 1: Horarios Semanales
  diasConfig: DiaConfig[] = [
    { dia: 1, nombre: 'Lunes', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 2, nombre: 'Martes', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 3, nombre: 'Miércoles', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 4, nombre: 'Jueves', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 5, nombre: 'Viernes', activo: true, horaInicio: '09:00', horaFin: '19:00' },
    { dia: 6, nombre: 'Sábado', activo: true, horaInicio: '10:00', horaFin: '15:00' },
    { dia: 7, nombre: 'Domingo', activo: false, horaInicio: '10:00', horaFin: '14:00' },
  ];

  // Tab 2: Excepciones
  excepciones = signal<ExcepcionHorario[]>([]);
  cargandoExcepciones = signal(false);
  modalExcepcionAbierto = signal(false);
  guardandoExcepcion = signal(false);
  excepcionModel: Partial<ExcepcionHorario> = {
    fecha: '',
    tipo: 'CERRADA',
    horaInicio: '09:00',
    horaFin: '14:00',
    motivo: ''
  };

  // Tab 3: Bloqueos
  bloqueos = signal<BloqueoAgenda[]>([]);
  cargandoBloqueos = signal(false);
  modalBloqueoAbierto = signal(false);
  guardandoBloqueo = signal(false);
  bloqueoModel: Partial<CreateBloqueoDto> = {
    fecha: '',
    horaInicio: '12:00',
    horaFin: '13:00',
    motivo: '',
    liberacionAutomaticaMinutos: undefined
  };

  ngOnInit() {
    this.cargarHorariosActuales();
    this.cargarExcepciones();
    this.cargarBloqueos();
  }

  cambiarTab(tab: TabActiva) {
    this.tabActiva.set(tab);
    this.mensajeExito.set('');
    this.mensajeError.set('');
  }

  cargarHorariosActuales() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.horariosService.obtenerHorarios(barberia.id).subscribe({
      next: (horarios) => {
        if (horarios && horarios.length > 0) {
          this.diasConfig.forEach(d => d.activo = false);
          horarios.forEach(h => {
            const config = this.diasConfig.find(d => d.dia === h.diaSemana);
            if (config) {
              config.activo = true;
              config.horaInicio = h.horaInicio;
              config.horaFin = h.horaFin;
            }
          });
        }
      },
      error: () => {}
    });
  }

  toggleDia(dia: DiaConfig) {
    dia.activo = !dia.activo;
  }

  guardarHorarios() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.guardando.set(true);
    this.mensajeExito.set('');
    this.mensajeError.set('');

    const payload: Omit<Horario, 'id'>[] = this.diasConfig
      .filter(d => d.activo)
      .map(d => ({
        diaSemana: d.dia,
        horaInicio: d.horaInicio,
        horaFin: d.horaFin
      }));

    this.horariosService.configurarHorarios(barberia.id, payload).subscribe({
      next: () => {
        this.guardando.set(false);
        this.mostrarExito('Horarios semanales guardados exitosamente.');
      },
      error: (err) => {
        this.guardando.set(false);
        this.mostrarError(err.error?.message || 'Error al guardar los horarios');
      }
    });
  }

  // --- LÓGICA DE EXCEPCIONES ---
  cargarExcepciones() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.cargandoExcepciones.set(true);
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const to = new Date(Date.now() + 180 * 86400000).toISOString();

    this.horariosService.obtenerExcepciones(barberia.id, from, to).subscribe({
      next: (data) => {
        this.excepciones.set(data || []);
        this.cargandoExcepciones.set(false);
      },
      error: () => {
        this.cargandoExcepciones.set(false);
      }
    });
  }

  abrirModalExcepcion() {
    this.excepcionModel = {
      fecha: new Date().toISOString().split('T')[0],
      tipo: 'CERRADA',
      horaInicio: '09:00',
      horaFin: '14:00',
      motivo: ''
    };
    this.modalExcepcionAbierto.set(true);
  }

  cerrarModalExcepcion() {
    this.modalExcepcionAbierto.set(false);
  }

  guardarExcepcion() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    if (!this.excepcionModel.fecha) {
      this.mostrarError('La fecha de la excepción es obligatoria.');
      return;
    }

    if (this.excepcionModel.tipo === 'HORARIO_ESPECIAL' && (!this.excepcionModel.horaInicio || !this.excepcionModel.horaFin)) {
      this.mostrarError('Debes indicar hora de inicio y de fin para un horario especial.');
      return;
    }

    this.guardandoExcepcion.set(true);
    this.horariosService.agregarExcepcion(barberia.id, this.excepcionModel as ExcepcionHorario).subscribe({
      next: () => {
        this.guardandoExcepcion.set(false);
        this.cerrarModalExcepcion();
        this.cargarExcepciones();
        this.mostrarExito('Excepción de horario registrada correctamente.');
      },
      error: (err) => {
        this.guardandoExcepcion.set(false);
        this.mostrarError(err.error?.message || 'Error al guardar la excepción');
      }
    });
  }

  // --- LÓGICA DE BLOQUEOS ---
  cargarBloqueos() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.cargandoBloqueos.set(true);
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const to = new Date(Date.now() + 60 * 86400000).toISOString();

    this.horariosService.obtenerBloqueos(barberia.id, from, to).subscribe({
      next: (data) => {
        this.bloqueos.set(data || []);
        this.cargandoBloqueos.set(false);
      },
      error: () => {
        this.cargandoBloqueos.set(false);
      }
    });
  }

  abrirModalBloqueo() {
    this.bloqueoModel = {
      fecha: new Date().toISOString().split('T')[0],
      horaInicio: '12:00',
      horaFin: '13:00',
      motivo: '',
      liberacionAutomaticaMinutos: undefined
    };
    this.modalBloqueoAbierto.set(true);
  }

  cerrarModalBloqueo() {
    this.modalBloqueoAbierto.set(false);
  }

  guardarBloqueo() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    if (!this.bloqueoModel.fecha || !this.bloqueoModel.horaInicio || !this.bloqueoModel.horaFin) {
      this.mostrarError('Fecha, hora de inicio y fin son obligatorios para el bloqueo.');
      return;
    }

    this.guardandoBloqueo.set(true);
    this.horariosService.crearBloqueo(barberia.id, this.bloqueoModel as CreateBloqueoDto).subscribe({
      next: () => {
        this.guardandoBloqueo.set(false);
        this.cerrarModalBloqueo();
        this.cargarBloqueos();
        this.mostrarExito('Bloqueo de agenda creado exitosamente.');
      },
      error: (err) => {
        this.guardandoBloqueo.set(false);
        this.mostrarError(err.error?.message || 'Error al crear el bloqueo');
      }
    });
  }

  eliminarBloqueo(id: string) {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    if (!confirm('¿Deseas desbloquear esta franja horaria inmediatamente?')) return;

    this.horariosService.eliminarBloqueo(barberia.id, id).subscribe({
      next: () => {
        this.cargarBloqueos();
        this.mostrarExito('Bloqueo eliminado y franja horaria liberada.');
      },
      error: (err) => {
        this.mostrarError(err.error?.message || 'Error al eliminar el bloqueo');
      }
    });
  }

  // --- HELPERS ---
  formatearFecha(fechaStr: string): string {
    if (!fechaStr) return '';
    try {
      const d = new Date(fechaStr);
      return d.toLocaleDateString('es-ES', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return fechaStr;
    }
  }

  private mostrarExito(msg: string) {
    this.mensajeExito.set(msg);
    this.mensajeError.set('');
    setTimeout(() => this.mensajeExito.set(''), 4500);
  }

  private mostrarError(msg: string) {
    this.mensajeError.set(msg);
    setTimeout(() => this.mensajeError.set(''), 5500);
  }
}
