import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { HorariosService, MiHorarioSemana } from '../../../core/services/horarios.service.js';
import { TenantService } from '../../../core/services/tenant.service.js';

/** Nombres por día ISO (1 = lunes … 7 = domingo). */
const NOMBRES_DIA: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

/** Semana de arranque cuando el barbero todavía no guardó nada. */
const SEMANA_POR_DEFECTO = [
  { diaSemana: 1, libre: false, inicio: '09:00', fin: '18:00' },
  { diaSemana: 2, libre: false, inicio: '09:00', fin: '18:00' },
  { diaSemana: 3, libre: false, inicio: '09:00', fin: '18:00' },
  { diaSemana: 4, libre: false, inicio: '09:00', fin: '18:00' },
  { diaSemana: 5, libre: false, inicio: '09:00', fin: '19:00' },
  { diaSemana: 6, libre: false, inicio: '10:00', fin: '15:00' },
  { diaSemana: 7, libre: true, inicio: '10:00', fin: '14:00' },
];

/**
 * V3 fase 5 · Mi Horario (panel del BARBERO).
 *
 * Aquí el barbero define SU semana: qué días trabaja, en qué horas y cuándo
 * descansa. El motor de disponibilidad intersecta este horario con el de la
 * sede y descarta el bloque de descanso, así que lo que se guarde aquí es lo
 * que el cliente verá como huecos reservables.
 *
 * El `barberoId` no viaja en la petición: lo pone el backend desde el JWT. Si un
 * barbero pudiera enviarlo, podría reescribir el horario de un compañero.
 *
 * Se envía la semana COMPLETA (los siete días, libres incluidos) porque una
 * semana explícita no obliga al motor a interpretar la ausencia de fila, y el
 * «día libre» deja de ser ambiguo.
 */
@Component({
  selector: 'app-barbero-horarios',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Cabecera -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div class="space-y-1">
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight">
            Mi <span class="gold-gradient-text">Horario</span>
          </h2>
          <p class="text-sm text-zinc-400 max-w-xl">
            Define tus días de trabajo y tus horas de descanso en
            {{ tenantService.nombreBarberiaActiva() }}. Fuera de estas horas el cliente no verá
            huecos disponibles para reservarte.
          </p>
        </div>

        <button
          type="button"
          (click)="guardar()"
          [disabled]="cargando() || guardando()"
          class="px-5 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-0.5 transition-transform flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          @if (guardando()) {
            <i class="pi pi-spin pi-spinner"></i>
            <span>Guardando...</span>
          } @else {
            <i class="pi pi-save"></i>
            <span>Guardar Mi Horario</span>
          }
        </button>
      </div>

      <!-- Origen de las horas que se están viendo -->
      @if (heredaHorarioSede() && !cargando()) {
        <div
          class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3"
          role="status"
        >
          <i class="pi pi-info-circle text-amber-400 mt-0.5"></i>
          <div class="text-sm text-amber-200">
            <p class="font-semibold">Todavía no tienes un horario propio en esta sede.</p>
            <p class="text-amber-200/80 text-xs mt-1">
              El motor está usando el horario de la sede. Estas horas son una propuesta inicial: al
              guardar pasarás a tener tu propia semana y se aplicarán los días libres y descansos que
              dejes aquí.
            </p>
          </div>
        </div>
      }

      <!-- Toast de éxito -->
      @if (mensajeExito()) {
        <div
          class="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm shadow-2xl flex items-center gap-2"
          role="status"
        >
          <i class="pi pi-check-circle"></i>
          <span>{{ mensajeExito() }}</span>
        </div>
      }

      <!-- Error de carga -->
      @if (errorCarga()) {
        <div
          class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-2"
          role="alert"
        >
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ errorCarga() }}</span>
          <button (click)="cargar()" class="text-rose-200 hover:text-white underline text-xs">
            Reintentar
          </button>
        </div>
      }

      <!-- Error del guardado (400/403/409 del backend) -->
      @if (errorGuardado()) {
        <div
          class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-2"
          role="alert"
        >
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span class="flex-1">{{ errorGuardado() }}</span>
        </div>
      }

      <!-- Cargando -->
      @if (cargando()) {
        <div class="flex flex-col items-center justify-center py-20 gap-3">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
          <p class="text-xs text-zinc-500">Cargando tu semana...</p>
        </div>
      } @else {
        <form [formGroup]="formSemana" (ngSubmit)="guardar()" novalidate class="space-y-4">
          <div class="glass-panel rounded-3xl border border-white/5 p-4 sm:p-6 space-y-3">
            <!-- Cabecera de columnas (solo escritorio) -->
            <div
              class="hidden lg:grid grid-cols-12 gap-4 px-3 pb-2 border-b border-white/5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"
            >
              <div class="col-span-3">Día</div>
              <div class="col-span-4">Horario de trabajo</div>
              <div class="col-span-5">Descanso / almuerzo</div>
            </div>

            <div formArrayName="dias" class="space-y-3">
              @for (dia of dias.controls; track dia.get('diaSemana')?.value; let i = $index) {
                <div
                  [formGroupName]="i"
                  class="rounded-2xl border p-4 transition-colors"
                  [class.border-white/10]="!dia.get('esDiaLibre')?.value"
                  [class.bg-white/[0.03]]="!dia.get('esDiaLibre')?.value"
                  [class.border-white/5]="dia.get('esDiaLibre')?.value"
                  [class.bg-transparent]="dia.get('esDiaLibre')?.value"
                >
                  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-center">
                    <!-- Día + toggle de día libre -->
                    <div class="lg:col-span-3 flex items-center justify-between lg:justify-start gap-3">
                      <div class="flex items-center gap-3">
                        <button
                          type="button"
                          (click)="toggleDiaLibre(i)"
                          [attr.aria-pressed]="dia.get('esDiaLibre')?.value"
                          [attr.aria-label]="'Marcar ' + nombreDia(i) + ' como día libre'"
                          class="w-11 h-6 rounded-full flex items-center p-1 transition-colors duration-300 shrink-0"
                          [class.bg-amber-500]="!dia.get('esDiaLibre')?.value"
                          [class.bg-zinc-700]="dia.get('esDiaLibre')?.value"
                        >
                          <span
                            class="w-4 h-4 rounded-full bg-white transform transition-transform duration-300"
                            [class.translate-x-5]="!dia.get('esDiaLibre')?.value"
                            [class.translate-x-0]="dia.get('esDiaLibre')?.value"
                          ></span>
                        </button>
                        <span class="font-semibold text-white">{{ nombreDia(i) }}</span>
                      </div>
                      @if (dia.get('esDiaLibre')?.value) {
                        <span
                          class="text-[11px] font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 px-2 py-0.5 rounded-full"
                        >
                          Día libre
                        </span>
                      }
                    </div>

                    <!-- Entrada / salida -->
                    <div class="lg:col-span-4 grid grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label
                          [for]="'inicio-' + i"
                          class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                        >
                          Entrada
                        </label>
                        <input
                          type="time"
                          [id]="'inicio-' + i"
                          formControlName="horaInicio"
                          class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div class="space-y-1">
                        <label
                          [for]="'fin-' + i"
                          class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                        >
                          Salida
                        </label>
                        <input
                          type="time"
                          [id]="'fin-' + i"
                          formControlName="horaFin"
                          class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <!-- Descanso -->
                    <div class="lg:col-span-5 space-y-2">
                      <div class="flex items-center justify-between gap-3">
                        <span class="lg:hidden text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                          Descanso / almuerzo
                        </span>
                        <button
                          type="button"
                          (click)="toggleDescanso(i)"
                          [disabled]="dia.get('esDiaLibre')?.value"
                          class="text-xs font-semibold rounded-lg px-3 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          [class.text-rose-300]="dia.get('tieneDescanso')?.value"
                          [class.border-rose-500/40]="dia.get('tieneDescanso')?.value"
                          [class.bg-rose-500/10]="dia.get('tieneDescanso')?.value"
                          [class.text-amber-300]="!dia.get('tieneDescanso')?.value"
                          [class.border-amber-500/40]="!dia.get('tieneDescanso')?.value"
                          [class.bg-amber-500/10]="!dia.get('tieneDescanso')?.value"
                        >
                          <i class="pi" [class.pi-plus]="!dia.get('tieneDescanso')?.value" [class.pi-times]="dia.get('tieneDescanso')?.value"></i>
                          {{ dia.get('tieneDescanso')?.value ? 'Quitar descanso' : '+ Añadir descanso' }}
                        </button>
                      </div>

                      @if (dia.get('tieneDescanso')?.value) {
                        <div class="grid grid-cols-2 gap-3 animate-fade-in">
                          <div class="space-y-1">
                            <label
                              [for]="'descanso-inicio-' + i"
                              class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                            >
                              Descanso desde
                            </label>
                            <input
                              type="time"
                              [id]="'descanso-inicio-' + i"
                              formControlName="horaInicioDescanso"
                              class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div class="space-y-1">
                            <label
                              [for]="'descanso-fin-' + i"
                              class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                            >
                              Descanso hasta
                            </label>
                            <input
                              type="time"
                              [id]="'descanso-fin-' + i"
                              formControlName="horaFinDescanso"
                              class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- Error del día -->
                  @if (erroresDia()[dia.get('diaSemana')?.value]) {
                    <p class="mt-3 text-xs text-rose-300 flex items-start gap-1.5" role="alert">
                      <i class="pi pi-exclamation-circle mt-0.5"></i>
                      <span>{{ erroresDia()[dia.get('diaSemana')?.value] }}</span>
                    </p>
                  }
                </div>
              }
            </div>

            <p class="text-xs text-zinc-500 flex items-start gap-2 pt-2 border-t border-white/5">
              <i class="pi pi-info-circle mt-0.5"></i>
              <span>
                Tu horario nunca puede exceder el de la sede: si abres a las 09:00 y la sede abre a
                las 10:00, las citas empezarán a las 10:00. Durante el descanso no se ofrecen citas.
              </span>
            </p>
          </div>
        </form>
      }
    </div>
  `,
})
export class BarberoHorariosComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly horariosService = inject(HorariosService);
  readonly tenantService = inject(TenantService);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly mensajeExito = signal('');
  readonly errorCarga = signal<string | null>(null);
  readonly errorGuardado = signal<string | null>(null);
  /** Un mensaje por día, indexado por `diaSemana` (1–7). */
  readonly erroresDia = signal<Record<number, string>>({});
  readonly heredaHorarioSede = signal(false);

  readonly formSemana = this.fb.group({
    dias: this.fb.array<FormGroup>([]),
  });

  private temporizadorExito?: ReturnType<typeof setTimeout>;

  get dias(): FormArray<FormGroup> {
    return this.formSemana.get('dias') as FormArray<FormGroup>;
  }

  ngOnInit(): void {
    this.cargar();
  }

  nombreDia(indice: number): string {
    const dia = this.dias.at(indice).get('diaSemana')?.value as number;
    return NOMBRES_DIA[dia] ?? '';
  }

  cargar(): void {
    const barberiaId = this.tenantService.barberiaActiva()?.id;
    this.errorCarga.set(null);

    if (!barberiaId) {
      this.cargando.set(false);
      this.errorCarga.set('No hay una sede activa. Elige una sede para configurar tu horario.');
      return;
    }

    this.cargando.set(true);
    this.horariosService.obtenerMiSemana(barberiaId).subscribe({
      next: (semana) => {
        this.aplicarSemana(semana);
        this.cargando.set(false);
      },
      error: (err) => {
        // La semana por defecto deja la pantalla usable aunque el GET falle; el
        // aviso rojo evita que el barbero guarde creyendo que vio sus horas.
        this.construirSemanaPorDefecto();
        this.heredaHorarioSede.set(true);
        this.cargando.set(false);
        this.errorCarga.set(this.mensajeDeError(err, 'No se pudo cargar tu horario.'));
      },
    });
  }

  /**
   * Convierte cualquier hora que venga del backend a `HH:mm`.
   *
   * Misma lección que en `admin-horarios.component.ts`: un `TIME` de Prisma
   * serializado llega como `"1970-01-01T08:00:00.000Z"` y un
   * `<input type="time">` solo acepta `"08:00"`. Sin esta normalización el input
   * queda en blanco y la consola se llena de errores de formato.
   */
  private normalizarHora(valor: string | null | undefined): string {
    if (!valor) return '';
    const iso = /T(\d{2}):(\d{2})/.exec(valor);
    if (iso) return `${iso[1]}:${iso[2]}`;
    const hhmm = /^(\d{2}):(\d{2})/.exec(valor);
    if (hhmm) return `${hhmm[1]}:${hhmm[2]}`;
    return '';
  }

  private construirDia(dia: {
    diaSemana: number;
    esDiaLibre: boolean;
    horaInicio: string | null;
    horaFin: string | null;
    horaInicioDescanso: string | null;
    horaFinDescanso: string | null;
  }): FormGroup {
    const libre = dia.esDiaLibre;
    const inicioDescanso = this.normalizarHora(dia.horaInicioDescanso);
    const finDescanso = this.normalizarHora(dia.horaFinDescanso);

    return this.fb.group({
      diaSemana: [dia.diaSemana],
      esDiaLibre: [libre],
      horaInicio: [this.normalizarHora(dia.horaInicio) || '09:00', [Validators.required]],
      horaFin: [this.normalizarHora(dia.horaFin) || '18:00', [Validators.required]],
      tieneDescanso: [Boolean(inicioDescanso && finDescanso)],
      horaInicioDescanso: [inicioDescanso],
      horaFinDescanso: [finDescanso],
    });
  }

  private aplicarSemana(semana: MiHorarioSemana): void {
    const porDia = new Map((semana?.dias ?? []).map((d) => [d.diaSemana, d]));

    this.dias.clear();
    for (const base of SEMANA_POR_DEFECTO) {
      const guardado = porDia.get(base.diaSemana);
      this.dias.push(
        this.construirDia(
          guardado ?? {
            diaSemana: base.diaSemana,
            esDiaLibre: base.libre,
            horaInicio: base.inicio,
            horaFin: base.fin,
            horaInicioDescanso: null,
            horaFinDescanso: null,
          },
        ),
      );
    }

    this.heredaHorarioSede.set(Boolean(semana?.heredaHorarioSede));
    this.actualizarEstadoHoras();
  }

  private construirSemanaPorDefecto(): void {
    this.dias.clear();
    for (const base of SEMANA_POR_DEFECTO) {
      this.dias.push(
        this.construirDia({
          diaSemana: base.diaSemana,
          esDiaLibre: base.libre,
          horaInicio: base.inicio,
          horaFin: base.fin,
          horaInicioDescanso: null,
          horaFinDescanso: null,
        }),
      );
    }
    this.actualizarEstadoHoras();
  }

  /** Un día libre (o un descanso apagado) no debe permitir escribir horas. */
  private actualizarEstadoHoras(): void {
    for (const grupo of this.dias.controls) {
      const libre = Boolean(grupo.get('esDiaLibre')?.value);
      const conDescanso = Boolean(grupo.get('tieneDescanso')?.value) && !libre;

      const aplicar = (nombre: string, habilitado: boolean) => {
        const control = grupo.get(nombre);
        if (!control) return;
        if (habilitado) control.enable({ emitEvent: false });
        else control.disable({ emitEvent: false });
      };

      aplicar('horaInicio', !libre);
      aplicar('horaFin', !libre);
      aplicar('horaInicioDescanso', conDescanso);
      aplicar('horaFinDescanso', conDescanso);
    }
  }

  toggleDiaLibre(indice: number): void {
    const grupo = this.dias.at(indice);
    const libre = !grupo.get('esDiaLibre')?.value;

    grupo.get('esDiaLibre')?.setValue(libre);

    if (libre) {
      grupo.get('tieneDescanso')?.setValue(false);
      grupo.get('horaInicioDescanso')?.setValue('');
      grupo.get('horaFinDescanso')?.setValue('');
    } else {
      if (!grupo.get('horaInicio')?.value) grupo.get('horaInicio')?.setValue('09:00');
      if (!grupo.get('horaFin')?.value) grupo.get('horaFin')?.setValue('18:00');
    }

    this.actualizarEstadoHoras();
    this.limpiarErrorDia(grupo);
  }

  toggleDescanso(indice: number): void {
    const grupo = this.dias.at(indice);
    if (grupo.get('esDiaLibre')?.value) return;

    const activo = !grupo.get('tieneDescanso')?.value;
    grupo.get('tieneDescanso')?.setValue(activo);

    if (activo) {
      if (!grupo.get('horaInicioDescanso')?.value) {
        grupo.get('horaInicioDescanso')?.setValue('13:00');
      }
      if (!grupo.get('horaFinDescanso')?.value) {
        grupo.get('horaFinDescanso')?.setValue('14:00');
      }
    } else {
      grupo.get('horaInicioDescanso')?.setValue('');
      grupo.get('horaFinDescanso')?.setValue('');
    }

    this.actualizarEstadoHoras();
    this.limpiarErrorDia(grupo);
  }

  guardar(): void {
    const barberiaId = this.tenantService.barberiaActiva()?.id;
    if (!barberiaId) {
      this.errorGuardado.set('No hay una sede activa. Elige una sede para guardar tu horario.');
      return;
    }

    const errores = this.validarSemana();
    this.erroresDia.set(errores);

    if (Object.keys(errores).length > 0) {
      this.errorGuardado.set('Revisa los días marcados: hay horas que no son válidas.');
      return;
    }

    const payload = this.dias.controls.map((grupo) => {
      const libre = Boolean(grupo.get('esDiaLibre')?.value);
      const conDescanso = Boolean(grupo.get('tieneDescanso')?.value) && !libre;

      return {
        diaSemana: grupo.get('diaSemana')?.value as number,
        esDiaLibre: libre,
        horaInicio: libre ? null : (grupo.get('horaInicio')?.value as string),
        horaFin: libre ? null : (grupo.get('horaFin')?.value as string),
        horaInicioDescanso: conDescanso
          ? (grupo.get('horaInicioDescanso')?.value as string)
          : null,
        horaFinDescanso: conDescanso ? (grupo.get('horaFinDescanso')?.value as string) : null,
      };
    });

    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.mensajeExito.set('');

    this.horariosService.guardarMiSemana(barberiaId, payload).subscribe({
      next: (semana) => {
        this.guardando.set(false);
        // El backend devuelve la semana canónica: se repinta con lo guardado en
        // lugar de confiar en los valores del formulario.
        this.aplicarSemana(semana);
        this.mostrarExito('Tu horario se guardó correctamente.');
      },
      error: (err) => {
        this.guardando.set(false);
        this.errorGuardado.set(
          this.mensajeDeError(err, 'No se pudo guardar tu horario. Intenta de nuevo.'),
        );
      },
    });
  }

  private validarSemana(): Record<number, string> {
    const errores: Record<number, string> = {};

    for (const grupo of this.dias.controls) {
      const diaSemana = grupo.get('diaSemana')?.value as number;
      const libre = Boolean(grupo.get('esDiaLibre')?.value);
      if (libre) continue;

      const inicio = grupo.get('horaInicio')?.value as string;
      const fin = grupo.get('horaFin')?.value as string;

      if (!inicio || !fin) {
        errores[diaSemana] = 'Indica la hora de entrada y la de salida.';
        continue;
      }
      if (this.aMinutos(inicio) >= this.aMinutos(fin)) {
        errores[diaSemana] = 'La salida debe ser posterior a la entrada.';
        continue;
      }

      if (grupo.get('tieneDescanso')?.value) {
        const inicioDescanso = grupo.get('horaInicioDescanso')?.value as string;
        const finDescanso = grupo.get('horaFinDescanso')?.value as string;

        if (!inicioDescanso || !finDescanso) {
          errores[diaSemana] = 'Indica el inicio y el fin del descanso.';
          continue;
        }

        const desde = this.aMinutos(inicioDescanso);
        const hasta = this.aMinutos(finDescanso);

        if (desde >= hasta) {
          errores[diaSemana] = 'El descanso debe terminar después de empezar.';
          continue;
        }
        // La misma regla del backend: el descanso va DENTRO del horario.
        if (desde < this.aMinutos(inicio) || hasta > this.aMinutos(fin)) {
          errores[diaSemana] = 'El descanso debe estar dentro de tu horario de trabajo.';
        }
      }
    }

    return errores;
  }

  private aMinutos(hora: string): number {
    const [hh, mm] = hora.split(':').map(Number);
    return hh * 60 + mm;
  }

  private limpiarErrorDia(grupo: AbstractControl): void {
    const diaSemana = grupo.get('diaSemana')?.value as number;
    const actuales = { ...this.erroresDia() };
    if (!actuales[diaSemana]) return;
    delete actuales[diaSemana];
    this.erroresDia.set(actuales);
    if (Object.keys(actuales).length === 0) this.errorGuardado.set(null);
  }

  private mostrarExito(mensaje: string): void {
    this.mensajeExito.set(mensaje);
    if (this.temporizadorExito) clearTimeout(this.temporizadorExito);
    this.temporizadorExito = setTimeout(() => this.mensajeExito.set(''), 4000);
  }

  /** Mensaje legible del backend (400 de validación, 403 de sede, 409…). */
  private mensajeDeError(err: unknown, porDefecto: string): string {
    const cuerpo = (err as { error?: { message?: string | string[]; mensaje?: string } })?.error;
    const detalle = cuerpo?.mensaje ?? cuerpo?.message;

    if (Array.isArray(detalle)) return detalle.join(' ');
    if (typeof detalle === 'string' && detalle.trim()) return detalle;

    const estatus = (err as { status?: number })?.status;
    if (estatus === 403) return 'No tienes permiso para configurar el horario en esta sede.';
    if (estatus === 0) return 'No se pudo conectar con el servidor. Revisa tu conexión.';

    return porDefecto;
  }
}
