import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { HorariosService, Horario, ExcepcionHorario, BloqueoAgenda, CreateBloqueoDto } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/** Nombres por día ISO (1 = lunes … 7 = domingo), el mismo orden del motor. */
const NOMBRES_DIA: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

/**
 * Semana que se ofrece cuando la sede todavía no guardó ninguna fila.
 *
 * Es una propuesta, no un valor inventado: la pantalla la muestra igual que el
 * panel del barbero para que el administrador pueda ajustar en vez de partir de
 * siete días en blanco.
 */
const SEMANA_POR_DEFECTO = [
  { diaSemana: 1, activo: true, inicio: '09:00', fin: '18:00' },
  { diaSemana: 2, activo: true, inicio: '09:00', fin: '18:00' },
  { diaSemana: 3, activo: true, inicio: '09:00', fin: '18:00' },
  { diaSemana: 4, activo: true, inicio: '09:00', fin: '18:00' },
  { diaSemana: 5, activo: true, inicio: '09:00', fin: '19:00' },
  { diaSemana: 6, activo: true, inicio: '10:00', fin: '15:00' },
  { diaSemana: 7, activo: false, inicio: '10:00', fin: '14:00' },
];

/** Un peldaño de la jerarquía de resolución que pinta la cabecera del panel. */
interface NivelJerarquia {
  orden: number;
  titulo: string;
  detalle: string;
  icono: string;
  /** El nivel que se edita en ESTA pantalla. */
  destacado: boolean;
}

type TabActiva = 'semanal' | 'excepciones' | 'bloqueos';

import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';

@Component({
  selector: 'app-admin-horarios',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ModalShellComponent],
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

      <!-- AVISO DE ALCANCE: el horario semanal es el de la SEDE, no el del barbero -->
      <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs sm:text-sm text-amber-200 flex items-start gap-3">
        <i class="pi pi-info-circle text-amber-400 text-base mt-0.5 shrink-0"></i>
        <p class="leading-relaxed">
          Estás configurando el horario de apertura general para la sede:
          <strong class="text-amber-300">{{ tenantService.nombreBarberiaActiva() || 'sin sede activa' }}</strong>.
          Fuera de este horario no se podrán agendar citas.
        </p>
      </div>

      <!-- JERARQUÍA DE PRECEDENCIA: el panel edita UNO de los cuatro niveles, y
           saber cuál gana explica por qué un barbero no aparece en la agenda. -->
      <div class="glass-panel p-5 sm:p-6 rounded-3xl border border-white/5 space-y-4">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <i class="pi pi-sort-amount-down text-sm"></i>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-white">Cómo se resuelve la disponibilidad</h3>
            <p class="text-xs text-zinc-400">
              Cuando dos horarios chocan gana siempre el más específico. La jornada efectiva de un
              barbero es la intersección de todo lo que le aplica, nunca la suma.
            </p>
          </div>
        </div>

        <ol class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          @for (nivel of jerarquia; track nivel.orden) {
            <li
              class="rounded-2xl border p-3.5 flex flex-col gap-1.5 transition-colors"
              [ngClass]="nivel.destacado
                ? 'border-amber-500/30 bg-amber-500/[0.06]'
                : 'border-white/5 bg-white/[0.02]'"
            >
              <div class="flex items-center gap-2">
                <span
                  class="w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0"
                  [ngClass]="nivel.destacado
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'"
                >
                  {{ nivel.orden }}
                </span>
                <i class="pi text-xs"
                   [ngClass]="[nivel.icono, nivel.destacado ? 'text-amber-400' : 'text-zinc-500']"></i>
                <span class="text-xs font-semibold text-white truncate">{{ nivel.titulo }}</span>
              </div>
              <p class="text-[11px] leading-relaxed text-zinc-400">{{ nivel.detalle }}</p>
            </li>
          }
        </ol>

        <p class="text-[11px] text-zinc-500 flex items-start gap-2 pt-1 border-t border-white/5">
          <i class="pi pi-info-circle mt-0.5"></i>
          <span>
            Una <strong class="text-zinc-300">excepción de sede</strong> por fecha (pestaña
            «Excepciones») cierra o recorta ese día para todos; y ningún barbero puede abrir más
            allá del horario de la sede.
          </span>
        </p>
      </div>

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
        <div class="glass-panel p-5 sm:p-6 rounded-3xl border border-white/5 space-y-4">
          <!-- Alcance + resumen en vivo -->
          <div class="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/5">
            <div>
              <h3 class="text-base font-semibold text-white">Jornada semanal de la sede</h3>
              <p class="text-xs text-zinc-400">
                Semana ISO (1 = lunes … 7 = domingo). El motor intersecta esta jornada con el
                horario de cada barbero: nadie puede abrir fuera de ella.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span class="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5">
                <i class="pi pi-calendar-plus text-[10px]"></i>
                {{ diasAbiertos() }} / 7 días
              </span>
              <span class="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-1.5">
                <i class="pi pi-clock text-[10px]"></i>
                {{ horasSemanales() }} h / semana
              </span>
            </div>
          </div>

          <!-- Cabecera de columnas (solo escritorio) -->
          <div class="hidden lg:grid grid-cols-12 gap-4 px-3 pb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            <div class="col-span-4">Día (ISO 1–7)</div>
            <div class="col-span-8">Ventana de atención</div>
          </div>

          <form [formGroup]="formSemana" novalidate>
            <div formArrayName="dias" class="space-y-3">
              @for (dia of dias.controls; track dia.get('diaSemana')?.value; let i = $index) {
                <div
                  [formGroupName]="i"
                  class="rounded-2xl border p-4 transition-colors"
                  [ngClass]="{
                    'bg-white/[0.03] border-white/10': dia.get('activo')?.value && !errorDe(dia),
                    'bg-transparent border-white/5': !dia.get('activo')?.value && !errorDe(dia),
                    'bg-rose-500/[0.04] border-rose-500/40': !!errorDe(dia)
                  }"
                >
                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-center">
                    <!-- Día + interruptor -->
                    <div class="lg:col-span-4 flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        [attr.aria-checked]="dia.get('activo')?.value"
                        [attr.aria-label]="(dia.get('activo')?.value ? 'Cerrar ' : 'Abrir ') + nombreDia(i)"
                        (click)="alternarDia(i)"
                        class="w-11 h-6 rounded-full flex items-center p-1 transition-colors duration-300 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        [class.bg-amber-500]="dia.get('activo')?.value"
                        [class.bg-zinc-700]="!dia.get('activo')?.value"
                      >
                        <span
                          class="w-4 h-4 rounded-full bg-white transform transition-transform duration-300"
                          [class.translate-x-5]="dia.get('activo')?.value"
                          [class.translate-x-0]="!dia.get('activo')?.value"
                        ></span>
                      </button>

                      <div class="min-w-0">
                        <p class="font-semibold text-white text-sm">{{ nombreDia(i) }}</p>
                        <p class="text-[10px] uppercase tracking-wider text-zinc-500">
                          ISO {{ dia.get('diaSemana')?.value }}
                        </p>
                      </div>

                      @if (!dia.get('activo')?.value) {
                        <span class="text-[11px] font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 px-2 py-0.5 rounded-full ml-auto lg:ml-1">
                          Cerrado
                        </span>
                      }
                    </div>

                    <!-- Apertura / cierre -->
                    <div class="lg:col-span-8 grid grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label
                          [for]="'apertura-' + i"
                          class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                        >
                          Apertura
                        </label>
                        <input
                          type="time"
                          [id]="'apertura-' + i"
                          formControlName="horaInicio"
                          class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div class="space-y-1">
                        <label
                          [for]="'cierre-' + i"
                          class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                        >
                          Cierre
                        </label>
                        <input
                          type="time"
                          [id]="'cierre-' + i"
                          formControlName="horaFin"
                          class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Validación del día, junto a la fila que hay que corregir -->
                  @if (errorDe(dia)) {
                    <p class="mt-3 text-xs text-rose-300 flex items-start gap-1.5" role="alert">
                      <i class="pi pi-exclamation-circle mt-0.5"></i>
                      <span>{{ errorDe(dia) }}</span>
                    </p>
                  }
                </div>
              }
            </div>
          </form>

          @if (sinDiasActivos()) {
            <p class="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2 flex items-start gap-2" role="alert">
              <i class="pi pi-exclamation-triangle mt-0.5"></i>
              <span>
                No hay ningún día abierto: la sede no ofrecerá horarios y ningún cliente podrá
                reservar.
              </span>
            </p>
          }

          <p class="text-xs text-zinc-500 flex items-start gap-2 pt-2 border-t border-white/5">
            <i class="pi pi-info-circle mt-0.5"></i>
            <span>
              Los días apagados no ofrecen ninguna cita. Para cerrar una fecha suelta sin tocar la
              semana usa la pestaña <strong class="text-zinc-300">Excepciones</strong>: allí el
              cambio vale solo para ese día.
            </span>
          </p>
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
                            <span class="font-medium text-amber-300">{{ formatearHora(exc.horaInicio) }} - {{ formatearHora(exc.horaFin) }}</span>
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
                            {{ formatearHora(b.horaInicio) }} - {{ formatearHora(b.horaFin) }}
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
      <app-modal-shell
        [visible]="modalExcepcionAbierto()"
        titulo="Nueva Excepción de Horario"
        subtitulo="Feriados, días festivos o jornada especial"
        icono="pi pi-calendar-times"
        [cerrarBloqueado]="guardandoExcepcion()"
        (cerrar)="cerrarModalExcepcion()">
        <div class="space-y-4">
          <div>
            <label for="sede-excepcion-fecha" class="block text-xs font-semibold text-zinc-400 mb-1.5">Fecha</label>
            <input id="sede-excepcion-fecha" type="date" [(ngModel)]="excepcionModel.fecha"
                   class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
          </div>

          <div>
            <label for="sede-excepcion-tipo" class="block text-xs font-semibold text-zinc-400 mb-1.5">Tipo de Excepción</label>
            <select id="sede-excepcion-tipo" [(ngModel)]="excepcionModel.tipo"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
              <option value="CERRADA">Sede Cerrada (Todo el día no laborable)</option>
              <option value="HORARIO_ESPECIAL">Horario Especial (Apertura y Cierre personalizado)</option>
            </select>
          </div>

          @if (excepcionModel.tipo === 'HORARIO_ESPECIAL') {
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="sede-excepcion-inicio" class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Inicio</label>
                <input id="sede-excepcion-inicio" type="time" [(ngModel)]="excepcionModel.horaInicio"
                       class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
              </div>
              <div>
                <label for="sede-excepcion-fin" class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Fin</label>
                <input id="sede-excepcion-fin" type="time" [(ngModel)]="excepcionModel.horaFin"
                       class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
              </div>
            </div>
          }

          <div>
            <label for="sede-excepcion-motivo" class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo o Justificación</label>
            <input id="sede-excepcion-motivo" type="text" [(ngModel)]="excepcionModel.motivo" placeholder="Ej. Navidad, Año Nuevo, Fumigación..."
                   class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
          </div>
        </div>

        <div modal-footer class="flex gap-3 pt-4 border-t border-zinc-800">
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
      </app-modal-shell>

      <!-- ================= MODAL NUEVO BLOQUEO ================= -->
      <app-modal-shell
        [visible]="modalBloqueoAbierto()"
        titulo="Nuevo Bloqueo de Franja"
        subtitulo="Bloquea turnos temporales en la agenda"
        icono="pi pi-clock"
        [cerrarBloqueado]="guardandoBloqueo()"
        (cerrar)="cerrarModalBloqueo()">
        <div class="space-y-4">
          <div>
            <label for="bloqueo-fecha" class="block text-xs font-semibold text-zinc-400 mb-1.5">Fecha</label>
            <input id="bloqueo-fecha" type="date" [(ngModel)]="bloqueoModel.fecha"
                   class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="bloqueo-inicio" class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Inicio</label>
              <input id="bloqueo-inicio" type="time" [(ngModel)]="bloqueoModel.horaInicio"
                     class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
            </div>
            <div>
              <label for="bloqueo-fin" class="block text-xs font-semibold text-zinc-400 mb-1.5">Hora Fin</label>
              <input id="bloqueo-fin" type="time" [(ngModel)]="bloqueoModel.horaFin"
                     class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
            </div>
          </div>

          <div>
            <label for="bloqueo-motivo" class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo</label>
            <input id="bloqueo-motivo" type="text" [(ngModel)]="bloqueoModel.motivo" placeholder="Ej. Almuerzo general, Reparación de equipos..."
                   class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
          </div>

          <div>
            <label for="bloqueo-liberacion" class="block text-xs font-semibold text-zinc-400 mb-1.5">Auto-liberación (BullMQ)</label>
            <select id="bloqueo-liberacion" [(ngModel)]="bloqueoModel.liberacionAutomaticaMinutos"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors">
              <option [ngValue]="undefined">Manual (Hasta que se elimine)</option>
              <option [ngValue]="15">Liberar en 15 minutos</option>
              <option [ngValue]="30">Liberar en 30 minutos</option>
              <option [ngValue]="60">Liberar en 1 hora</option>
              <option [ngValue]="120">Liberar en 2 horas</option>
            </select>
          </div>
        </div>

        <div modal-footer class="flex gap-3 pt-4 border-t border-zinc-800">
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
      </app-modal-shell>

    </div>
  `
})
export class AdminHorariosComponent implements OnInit {
  protected tenantService = inject(TenantService);
  private horariosService = inject(HorariosService);
  private confirmDialog = inject(ConfirmDialogService);

  // Pestaña activa
  tabActiva = signal<TabActiva>('semanal');

  // Estados generales
  guardando = signal(false);
  private readonly toast = inject(ToastService);

  // Tab 1: Horarios Semanales (semana ISO 1–7 en formulario reactivo)
  private readonly fb = inject(FormBuilder);

  readonly formSemana = this.fb.group({
    dias: this.fb.array<FormGroup>([]),
  });

  /** Un mensaje por día, indexado por `diaSemana` (1–7). */
  readonly erroresDia = signal<Record<number, string>>({});
  readonly diasAbiertos = signal(0);
  /** Horas semanales abiertas, redondeadas a un decimal, para el resumen. */
  readonly horasSemanales = signal(0);
  readonly sinDiasActivos = computed(() => this.diasAbiertos() === 0);

  /**
   * Orden real de resolución del motor, de más concreta a más general. Se pinta
   * en el panel porque no es evidente: sin esta pista, un administrador no sabe
   * por qué un barbero concreto no ofrece huecos aunque la sede esté abierta.
   */
  readonly jerarquia: NivelJerarquia[] = [
    {
      orden: 1,
      titulo: 'Excepción del barbero',
      detalle:
        'Una fecha concreta manda sobre todo lo demás: si el barbero se cierra ese día, no hay huecos, aunque la sede esté abierta.',
      icono: 'pi-user',
      destacado: false,
    },
    {
      orden: 2,
      titulo: 'Horario de la sede',
      detalle:
        'Es el de esta pantalla: define la ventana real de atención y recorta cualquier horario que se salga de ella.',
      icono: 'pi-building',
      destacado: true,
    },
    {
      orden: 3,
      titulo: 'Plantilla base del barbero',
      detalle:
        'La semana que el barbero repite entre sedes. Se usa cuando en esta sede no declaró un horario propio.',
      icono: 'pi-th-large',
      destacado: false,
    },
    {
      orden: 4,
      titulo: 'Herencia de la sede',
      detalle:
        'Un barbero sin horario propio ni plantilla hereda tal cual esta jornada semanal.',
      icono: 'pi-refresh',
      destacado: false,
    },
  ];

  get dias(): FormArray<FormGroup> {
    return this.formSemana.get('dias') as FormArray<FormGroup>;
  }

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
    // Cada cambio de hora o de interruptor refresca el resumen y retira el
    // error de esa fila: corregir el dato es la señal de que ya está bien.
    this.formSemana.valueChanges.subscribe(() => this.actualizarResumen());
    this.cargarHorariosActuales();
    this.cargarExcepciones();
    this.cargarBloqueos();
  }

  cambiarTab(tab: TabActiva) {
    this.tabActiva.set(tab);
  }

  cargarHorariosActuales() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) {
      this.aplicarSemana([]);
      return;
    }

    this.horariosService.obtenerHorarios(barberia.id).subscribe({
      next: (horarios) => this.aplicarSemana(horarios ?? []),
      error: (err) => {
        // La propuesta por defecto deja la pantalla usable aunque falle el GET;
        // el aviso evita que se guarde creyendo que se vio lo que hay en la base.
        this.aplicarSemana([]);
        this.mostrarError(
          this.mensajeDeError(err, 'No se pudieron cargar los horarios de la sede.'),
        );
      },
    });
  }

  /**
   * Pinta la semana en el `FormArray`, siempre con los siete días.
   *
   * Si la sede no tiene filas se ofrece la semana por defecto como propuesta;
   * si tiene alguna, los días sin fila quedan CERRADOS: la ausencia de horario
   * es una decisión (ese día no abre), no un día «por configurar».
   */
  private aplicarSemana(horarios: Horario[]): void {
    const porDia = new Map((horarios ?? []).map((h) => [h.diaSemana, h]));
    const conFilas = porDia.size > 0;

    this.dias.clear();

    for (const base of SEMANA_POR_DEFECTO) {
      const guardado = porDia.get(base.diaSemana);

      // El backend puede devolver la hora como ISO (`1970-01-01T08:00:00.000Z`).
      // Un `<input type="time">` solo acepta `HH:mm`; sin normalizar, el
      // navegador descarta el valor y deja `--:--` además de escupir un error de
      // formato por cada input en la consola.
      const inicio =
        this.toTimeInputFormat(guardado?.horaInicio) || base.inicio;
      const fin = this.toTimeInputFormat(guardado?.horaFin) || base.fin;

      this.dias.push(
        this.construirDia({
          diaSemana: base.diaSemana,
          activo: conFilas ? Boolean(guardado) : base.activo,
          horaInicio: inicio,
          horaFin: fin,
        }),
      );
    }

    this.erroresDia.set({});
    this.actualizarResumen();
  }

  private construirDia(dia: {
    diaSemana: number;
    activo: boolean;
    horaInicio: string;
    horaFin: string;
  }): FormGroup {
    const grupo = this.fb.group({
      diaSemana: [dia.diaSemana],
      activo: [dia.activo],
      horaInicio: [dia.horaInicio, [Validators.required]],
      horaFin: [dia.horaFin, [Validators.required]],
    });

    this.aplicarEstadoHoras(grupo);
    return grupo;
  }

  /** Un día cerrado no debe dejar editar sus horas (ni enviarlas). */
  private aplicarEstadoHoras(grupo: FormGroup): void {
    const abierto = Boolean(grupo.get('activo')?.value);

    for (const nombre of ['horaInicio', 'horaFin']) {
      const control = grupo.get(nombre);
      if (!control) continue;
      if (abierto) control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
    }
  }

  /**
   * Normaliza cualquier representación de hora a `HH:mm`, que es lo único que
   * `<input type="time">` acepta. Cubre `"08:00"`, `"08:00:00"` y el ISO que
   * serializa Prisma (`"1970-01-01T08:00:00.000Z"`) sin reinterpretarlo en la
   * zona del navegador: la hora que se configura es la hora de la sede.
   */
  toTimeInputFormat(valor: string | null | undefined): string {
    if (!valor) return '';
    const texto = String(valor).trim();

    if (/^\d{1,2}:\d{2}$/.test(texto)) {
      return texto.padStart(5, '0');
    }

    const iso = /T(\d{2}):(\d{2})/.exec(texto);
    if (iso) {
      return `${iso[1]}:${iso[2]}`;
    }

    const conSegundos = /^(\d{1,2}):(\d{2}):\d{2}/.exec(texto);
    if (conSegundos) {
      return `${conSegundos[1].padStart(2, '0')}:${conSegundos[2]}`;
    }

    return texto;
  }

  /** Igual que `toTimeInputFormat`, pero tolera `undefined` para pintar tablas. */
  formatearHora(valor?: string): string {
    return this.toTimeInputFormat(valor) || '—';
  }

  nombreDia(indice: number): string {
    const diaSemana = this.dias.at(indice).get('diaSemana')?.value as number;
    return NOMBRES_DIA[diaSemana] ?? '';
  }

  /** Mensaje de validación del día, o `undefined` si la fila está bien. */
  errorDe(grupo: FormGroup): string | undefined {
    const diaSemana = grupo.get('diaSemana')?.value as number;
    return this.erroresDia()[diaSemana];
  }

  alternarDia(indice: number): void {
    const grupo = this.dias.at(indice);
    const abierto = !grupo.get('activo')?.value;

    grupo.get('activo')?.setValue(abierto);

    if (abierto) {
      if (!grupo.get('horaInicio')?.value) grupo.get('horaInicio')?.setValue('09:00');
      if (!grupo.get('horaFin')?.value) grupo.get('horaFin')?.setValue('18:00');
    }

    this.aplicarEstadoHoras(grupo);
    this.limpiarErrorDia(grupo);
    this.actualizarResumen();
  }

  private limpiarErrorDia(grupo: FormGroup): void {
    const diaSemana = grupo.get('diaSemana')?.value as number;
    if (!this.erroresDia()[diaSemana]) return;

    const resto = { ...this.erroresDia() };
    delete resto[diaSemana];
    this.erroresDia.set(resto);
  }

  /** Minutos desde medianoche de un `HH:mm`; `NaN` si el valor no es una hora. */
  private aMinutos(hora: string | null | undefined): number {
    const partes = /^(\d{1,2}):(\d{2})/.exec(hora ?? '');
    if (!partes) return Number.NaN;
    return Number(partes[1]) * 60 + Number(partes[2]);
  }

  private actualizarResumen(): void {
    let abiertos = 0;
    let minutos = 0;

    for (const grupo of this.dias.controls) {
      if (!grupo.get('activo')?.value) continue;
      abiertos += 1;

      const inicio = this.aMinutos(grupo.get('horaInicio')?.value as string);
      const fin = this.aMinutos(grupo.get('horaFin')?.value as string);
      if (fin > inicio) minutos += fin - inicio;
    }

    this.diasAbiertos.set(abiertos);
    this.horasSemanales.set(Math.round((minutos / 60) * 10) / 10);
  }

  /**
   * Reglas de la semana, con el mismo lenguaje que usa el panel del barbero.
   *
   * Se validan EN EL CLIENTE para que el error aparezca bajo la fila que hay
   * que corregir y no como un banner con el mensaje crudo del backend.
   */
  private validarSemana(): Record<number, string> {
    const errores: Record<number, string> = {};

    for (const grupo of this.dias.controls) {
      if (!grupo.get('activo')?.value) continue;

      const diaSemana = grupo.get('diaSemana')?.value as number;
      const inicio = grupo.get('horaInicio')?.value as string;
      const fin = grupo.get('horaFin')?.value as string;

      if (!inicio || !fin) {
        errores[diaSemana] = 'Indica la hora de apertura y la de cierre.';
        continue;
      }

      if (this.aMinutos(inicio) >= this.aMinutos(fin)) {
        errores[diaSemana] = 'El cierre debe ser posterior a la apertura del mismo día.';
      }
    }

    return errores;
  }

  /**
   * Traduce un fallo del servidor a algo accionable. Las horas ya se validaron
   * arriba, así que aquí solo quedan permisos, red y reglas de negocio.
   */
  private mensajeDeError(err: unknown, porDefecto: string): string {
    const estado = (err as { status?: number } | null)?.status;
    if (estado === 403) {
      return 'Solo el responsable de la sede puede cambiar su horario.';
    }
    return porDefecto;
  }

  guardarHorarios() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) {
      this.mostrarError('No hay una sede activa: elige una para configurar su horario.');
      return;
    }

    const errores = this.validarSemana();
    this.erroresDia.set(errores);

    if (Object.keys(errores).length > 0) {
      this.mostrarError('Revisa los días marcados: hay horas que no son válidas.');
      return;
    }

    const payload: Omit<Horario, 'id'>[] = this.dias.controls
      .filter((grupo) => grupo.get('activo')?.value)
      .map((grupo) => ({
        diaSemana: grupo.get('diaSemana')?.value as number,
        horaInicio: this.toTimeInputFormat(grupo.get('horaInicio')?.value as string),
        horaFin: this.toTimeInputFormat(grupo.get('horaFin')?.value as string),
      }));

    this.guardando.set(true);

    this.horariosService.configurarHorarios(barberia.id, payload).subscribe({
      next: () => {
        this.guardando.set(false);
        this.mostrarExito('Horario semanal de la sede guardado.');
      },
      error: (err) => {
        this.guardando.set(false);
        this.mostrarError(
          this.mensajeDeError(err, 'No se pudo guardar el horario de la sede.'),
        );
      },
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
      fecha: this.hoyLocal(),
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
      fecha: this.hoyLocal(),
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

  async eliminarBloqueo(id: string): Promise<void> {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Desbloquear franja',
      mensaje:
        '¿Deseas desbloquear esta franja horaria? La agenda volverá a ofrecer esas horas a los clientes de inmediato.',
      textoConfirmar: 'Sí, desbloquear',
      tono: 'peligro',
      icono: 'pi pi-unlock',
    });
    if (!confirmado) return;

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

  /**
   * Etiqueta de calendario del día de HOY, en la zona del navegador.
   *
   * `new Date().toISOString().split('T')[0]` devuelve el día en UTC: a partir
   * de las 20:00 en Santo Domingo (UTC-4) ya es el día siguiente, así que el
   * modal proponía como fecha por defecto un día que aún no había llegado.
   */
  private hoyLocal(): string {
    const ahora = new Date();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${ahora.getFullYear()}-${mes}-${dia}`;
  }

  /**
   * `fecha` de excepciones y bloqueos es una columna `DATE` sin hora: el
   * backend la envía como `YYYY-MM-DD` (o `YYYY-MM-DDT00:00:00.000Z`).
   *
   * `new Date('2026-11-01')` la ancla a medianoche UTC y `toLocaleDateString`
   * la pinta en la zona del navegador: en UTC-4 el 1 de noviembre aparecía
   * como «31 oct». Se leen año/mes/día del propio string y se construye una
   * fecha LOCAL con esos componentes, de modo que el día mostrado es siempre
   * el día guardado.
   */
  formatearFecha(fechaStr: string): string {
    if (!fechaStr) return '';
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaStr.trim());
    if (!partes) return fechaStr;

    const d = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
    if (Number.isNaN(d.getTime())) return fechaStr;

    return d.toLocaleDateString('es-ES', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  private mostrarExito(msg: string) {
    this.toast.success(msg, 'Horarios');
  }

  private mostrarError(msg: string) {
    this.toast.error(msg, 'Horarios');
  }
}
