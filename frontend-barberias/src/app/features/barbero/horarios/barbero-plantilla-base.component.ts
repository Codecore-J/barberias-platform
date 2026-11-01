import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import {
  type DiaPlantillaBase,
  type NuevaExcepcionBarbero,
  type PlantillaBaseSemana,
  HorariosService,
} from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';
import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';

type TipoExcepcion = 'CERRADA' | 'HORARIO_ESPECIAL';

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

/**
 * Semana de arranque: lunes a sábado de 09:00 a 19:00 y domingo apagado.
 *
 * Es una PROPUESTA, no un valor guardado: solo se envía al backend cuando el
 * barbero pulsa guardar. El domingo conserva horas aunque nazca apagado para que
 * encenderlo no obligue a teclearlas.
 */
const PLANTILLA_POR_DEFECTO: DiaPlantillaBase[] = [1, 2, 3, 4, 5, 6].map((diaSemana) => ({
  diaSemana,
  horaInicio: '09:00',
  horaFin: '19:00',
  activo: true,
})).concat([{ diaSemana: 7, horaInicio: '10:00', horaFin: '14:00', activo: false }]);

/**
 * V3 · plantilla semanal BASE del barbero.
 *
 * La pantalla que faltaba: la semana que el barbero declara UNA vez y que el
 * motor de disponibilidad usa como fuente por defecto en cualquier sede donde no
 * tenga un horario propio. Sin esto, la tabla `horarios_base_barbero` solo se
 * podía llenar con `curl`.
 *
 * Orden de precedencia que el barbero debe entender al leer la pantalla:
 * excepción de una fecha > horario de la sede (`mi-horario`) > esta plantilla >
 * horario de la sede como herencia.
 *
 * El `barberoId` nunca viaja en el guardado: el backend lo saca del JWT.
 */
@Component({
  selector: 'app-barbero-plantilla-base',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ModalShellComponent],
  template: `
    <section class="space-y-6">
      <!-- Estado de la plantilla -->
      @if (sinPlantilla() && !cargando()) {
        <div
          class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3"
          role="status"
        >
          <i class="pi pi-info-circle text-amber-400 mt-0.5"></i>
          <div class="text-sm text-amber-200">
            <p class="font-semibold">Todavía no guardaste tu plantilla semanal.</p>
            <p class="text-amber-200/80 text-xs mt-1">
              Lo de abajo es una propuesta (lunes a sábado de 09:00 a 19:00). Al guardar, el motor
              la usará en las sedes donde no tengas un horario propio.
            </p>
          </div>
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
          <button type="button" (click)="cargar()" class="text-rose-200 hover:text-white underline text-xs">
            Reintentar
          </button>
        </div>
      }

      @if (cargando()) {
        <div class="flex flex-col items-center justify-center py-20 gap-3">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
          <p class="text-xs text-zinc-500">Cargando tu plantilla...</p>
        </div>
      } @else {
        <form [formGroup]="formPlantilla" (ngSubmit)="guardar()" novalidate>
          <div class="glass-panel rounded-3xl border border-white/5 p-4 sm:p-6 space-y-4">
            <div class="flex items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div>
                <h3 class="text-base font-semibold text-white">Plantilla semanal</h3>
                <p class="text-xs text-zinc-400">
                  {{ diasActivos() }} de 7 días activos. Se aplica en todas tus sedes salvo donde
                  tengas un horario propio.
                </p>
              </div>
              <span class="hidden sm:inline text-[11px] text-zinc-500">Formato 24 h</span>
            </div>

            <!-- Cabecera de columnas (solo escritorio) -->
            <div
              class="hidden md:grid grid-cols-12 gap-4 px-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"
            >
              <div class="col-span-5">Día</div>
              <div class="col-span-3">Entrada</div>
              <div class="col-span-4">Salida</div>
            </div>

            <div formArrayName="dias" class="space-y-3">
              @for (dia of dias.controls; track dia.get('diaSemana')?.value; let i = $index) {
                <div
                  [formGroupName]="i"
                  class="rounded-2xl border p-4 transition-colors"
                  [class.border-white/10]="dia.get('activo')?.value"
                  [class.bg-white/[0.03]]="dia.get('activo')?.value"
                  [class.border-white/5]="!dia.get('activo')?.value"
                  [class.bg-transparent]="!dia.get('activo')?.value"
                >
                  <div class="grid grid-cols-1 md:grid-cols-12 gap-4 md:items-center">
                    <!-- Día + interruptor -->
                    <div class="md:col-span-5 flex items-center justify-between md:justify-start gap-3">
                      <div class="flex items-center gap-3">
                        <button
                          type="button"
                          role="switch"
                          [attr.aria-checked]="!!dia.get('activo')?.value"
                          [attr.aria-label]="'Activar ' + nombreDia(i)"
                          (click)="alternarDia(i)"
                          class="w-11 h-6 rounded-full flex items-center p-1 transition-colors duration-300 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                          [class.bg-amber-500]="dia.get('activo')?.value"
                          [class.bg-zinc-700]="!dia.get('activo')?.value"
                        >
                          <span
                            class="w-4 h-4 rounded-full bg-white transform transition-transform duration-300"
                            [class.translate-x-5]="dia.get('activo')?.value"
                            [class.translate-x-0]="!dia.get('activo')?.value"
                          ></span>
                        </button>
                        <span class="font-semibold text-white">{{ nombreDia(i) }}</span>
                      </div>

                      @if (!dia.get('activo')?.value) {
                        <span
                          class="text-[11px] font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 px-2 py-0.5 rounded-full"
                        >
                          No trabaja
                        </span>
                      }
                    </div>

                    <!-- Entrada -->
                    <div class="md:col-span-3 space-y-1">
                      <label
                        [for]="'plantilla-inicio-' + i"
                        class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                      >
                        Entrada
                      </label>
                      <input
                        type="time"
                        [id]="'plantilla-inicio-' + i"
                        formControlName="horaInicio"
                        class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>

                    <!-- Salida -->
                    <div class="md:col-span-4 space-y-1">
                      <label
                        [for]="'plantilla-fin-' + i"
                        class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold"
                      >
                        Salida
                      </label>
                      <input
                        type="time"
                        [id]="'plantilla-fin-' + i"
                        formControlName="horaFin"
                        class="w-full bg-zinc-900/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  @if (erroresDia()[dia.get('diaSemana')?.value]) {
                    <p class="mt-3 text-xs text-rose-300 flex items-start gap-1.5" role="alert">
                      <i class="pi pi-exclamation-circle mt-0.5"></i>
                      <span>{{ erroresDia()[dia.get('diaSemana')?.value] }}</span>
                    </p>
                  }
                </div>
              }
            </div>

            @if (errorGuardado()) {
              <p class="text-xs text-rose-300 flex items-start gap-1.5" role="alert">
                <i class="pi pi-exclamation-circle mt-0.5"></i>
                <span>{{ errorGuardado() }}</span>
              </p>
            }

            <!-- Acción principal -->
            <div
              class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-white/5"
            >
              <p class="text-xs text-zinc-500 flex items-start gap-2 max-w-xl">
                <i class="pi pi-info-circle mt-0.5"></i>
                <span>
                  La plantilla es tu horario por defecto: ninguna cita puede quedar fuera del
                  horario de la sede, así que si la sede abre más tarde, mandará la sede.
                </span>
              </p>

              <button
                type="submit"
                [disabled]="guardando() || cargando()"
                class="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                @if (guardando()) {
                  <i class="pi pi-spin pi-spinner"></i>
                  <span>Guardando...</span>
                } @else {
                  <i class="pi pi-save"></i>
                  <span>Guardar Plantilla Semanal</span>
                }
              </button>
            </div>
          </div>
        </form>

        <!-- Excepciones -->
        <div class="glass-panel rounded-3xl border border-white/5 p-4 sm:p-6 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-semibold text-white">Excepción de horario</h3>
              <p class="text-xs text-zinc-400">
                Un día suelto que no sigue la plantilla: día libre o jornada distinta.
              </p>
            </div>
            <button
              type="button"
              (click)="abrirExcepcion()"
              class="px-4 py-2 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors flex items-center justify-center gap-2"
            >
              <i class="pi pi-plus"></i>
              <span>Registrar excepción</span>
            </button>
          </div>
        </div>

        <!-- Modal de excepción -->
        <app-modal-shell
          [visible]="modalExcepcion()"
          titulo="Nueva excepción de horario"
          subtitulo="Solo para la fecha indicada"
          icono="pi pi-calendar-times"
          [cerrarBloqueado]="guardandoExcepcion()"
          (cerrar)="cerrarExcepcion()"
        >
          <div class="space-y-4" [formGroup]="formExcepcion">
            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1.5" for="excepcion-fecha">
                Fecha
              </label>
              <input
                id="excepcion-fecha"
                type="date"
                formControlName="fecha"
                class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1.5" for="excepcion-tipo">
                Tipo
              </label>
              <select
                id="excepcion-tipo"
                formControlName="tipo"
                class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
              >
                <option value="CERRADA">Día libre (todo el día)</option>
                <option value="HORARIO_ESPECIAL">Jornada especial (horas distintas)</option>
              </select>
            </div>

            @if (tipoExcepcion() === 'HORARIO_ESPECIAL') {
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label
                    class="block text-xs font-semibold text-zinc-400 mb-1.5"
                    for="excepcion-inicio"
                  >
                    Desde
                  </label>
                  <input
                    id="excepcion-inicio"
                    type="time"
                    formControlName="horaInicio"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-zinc-400 mb-1.5" for="excepcion-fin">
                    Hasta
                  </label>
                  <input
                    id="excepcion-fin"
                    type="time"
                    formControlName="horaFin"
                    class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
            }

            <div>
              <label class="block text-xs font-semibold text-zinc-400 mb-1.5" for="excepcion-motivo">
                Motivo <span class="text-zinc-500 font-normal">(opcional)</span>
              </label>
              <input
                id="excepcion-motivo"
                type="text"
                formControlName="motivo"
                placeholder="Ej. trámite personal, cita médica..."
                class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            @if (errorExcepcion()) {
              <p class="text-xs text-rose-300 flex items-start gap-1.5" role="alert">
                <i class="pi pi-exclamation-circle mt-0.5"></i>
                <span>{{ errorExcepcion() }}</span>
              </p>
            }
          </div>

          <div modal-footer class="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              (click)="cerrarExcepcion()"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="registrarExcepcion()"
              [disabled]="guardandoExcepcion()"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <i class="pi" [ngClass]="guardandoExcepcion() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
              <span>{{ guardandoExcepcion() ? 'Guardando...' : 'Guardar excepción' }}</span>
            </button>
          </div>
        </app-modal-shell>
      }
    </section>
  `,
})
export class BarberoPlantillaBaseComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly horariosService = inject(HorariosService);
  private readonly tenantService = inject(TenantService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly sinPlantilla = signal(false);
  readonly errorCarga = signal<string | null>(null);
  readonly errorGuardado = signal<string | null>(null);
  /** Un mensaje por día, indexado por `diaSemana` (1–7). */
  readonly erroresDia = signal<Record<number, string>>({});

  readonly modalExcepcion = signal(false);
  readonly guardandoExcepcion = signal(false);
  readonly errorExcepcion = signal<string | null>(null);

  readonly formPlantilla = this.fb.group({
    dias: this.fb.array<FormGroup>([]),
  });

  readonly formExcepcion = this.fb.group({
    fecha: [this.hoy(), [Validators.required]],
    tipo: ['CERRADA' as TipoExcepcion, [Validators.required]],
    horaInicio: ['10:00'],
    horaFin: ['14:00'],
    motivo: [''],
  });

  /** El bloque de horas solo se pinta (y se envía) en la jornada especial. */
  readonly tipoExcepcion = toSignal(
    this.formExcepcion.controls.tipo.valueChanges.pipe(startWith('CERRADA' as TipoExcepcion)),
    { initialValue: 'CERRADA' as TipoExcepcion },
  );

  get dias(): FormArray<FormGroup> {
    return this.formPlantilla.get('dias') as FormArray<FormGroup>;
  }

  readonly diasActivos = () =>
    this.dias.controls.filter((dia) => Boolean(dia.get('activo')?.value)).length;

  ngOnInit(): void {
    this.cargar();
  }

  nombreDia(indice: number): string {
    const dia = this.dias.at(indice).get('diaSemana')?.value as number;
    return NOMBRES_DIA[dia] ?? '';
  }

  cargar(): void {
    const barberiaId = this.barberiaActivaId();
    this.errorCarga.set(null);

    if (!barberiaId) {
      this.cargando.set(false);
      this.errorCarga.set('No hay una sede activa. Elige una sede para configurar tu plantilla.');
      return;
    }

    this.cargando.set(true);
    this.horariosService
      .obtenerPlantillaBase(barberiaId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plantilla) => {
          this.aplicarPlantilla(plantilla);
          this.cargando.set(false);
        },
        error: () => {
          // La propuesta por defecto deja la pantalla utilizable, pero el aviso
          // evita que el barbero guarde creyendo que vio lo que tenía.
          this.aplicarPlantilla({ barberoId: '', sinPlantilla: true, dias: [] });
          this.errorCarga.set('No se pudo cargar tu plantilla. Se muestra la propuesta por defecto.');
          this.cargando.set(false);
        },
      });
  }

  alternarDia(indice: number): void {
    const grupo = this.dias.at(indice);
    const activo = !grupo.get('activo')?.value;

    grupo.get('activo')?.setValue(activo);

    // Un día inactivo no acepta horas: el motor lo lee como «no trabaja».
    const inicio = grupo.get('horaInicio');
    const fin = grupo.get('horaFin');
    if (activo) {
      inicio?.enable({ emitEvent: false });
      fin?.enable({ emitEvent: false });
      if (!inicio?.value) inicio?.setValue('09:00');
      if (!fin?.value) fin?.setValue('19:00');
    } else {
      inicio?.disable({ emitEvent: false });
      fin?.disable({ emitEvent: false });
    }

    this.limpiarErrorDia(grupo);
  }

  guardar(): void {
    const barberiaId = this.barberiaActivaId();
    if (!barberiaId) {
      this.errorGuardado.set('No hay una sede activa. Elige una sede para guardar tu plantilla.');
      return;
    }

    const errores = this.validarPlantilla();
    this.erroresDia.set(errores);

    if (Object.keys(errores).length > 0) {
      this.errorGuardado.set('Revisa los días marcados: hay horas que no son válidas.');
      return;
    }

    const payload: DiaPlantillaBase[] = this.dias.controls.map((grupo) => {
      const activo = Boolean(grupo.get('activo')?.value);

      return {
        diaSemana: grupo.get('diaSemana')?.value as number,
        activo,
        // Un día apagado se envía sin horas: el backend apaga el bloque si ya
        // existía y no crea una fila vacía si nunca existió.
        horaInicio: activo ? (grupo.get('horaInicio')?.value as string) : null,
        horaFin: activo ? (grupo.get('horaFin')?.value as string) : null,
      };
    });

    this.guardando.set(true);
    this.errorGuardado.set(null);

    this.horariosService
      .guardarPlantillaBase(barberiaId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plantilla) => {
          this.guardando.set(false);
          // Se repinta con lo que devolvió el backend, no con el formulario: así
          // la pantalla muestra exactamente lo guardado.
          this.aplicarPlantilla(plantilla);
          this.toast.success('Tu plantilla semanal se guardó correctamente.', 'Plantilla guardada');
        },
        error: () => {
          // El interceptor global ya muestra el mensaje del backend (400/403);
          // aquí solo se rehabilita el botón.
          this.guardando.set(false);
          this.errorGuardado.set('No se pudo guardar la plantilla. Intenta de nuevo.');
        },
      });
  }

  abrirExcepcion(): void {
    this.errorExcepcion.set(null);
    this.formExcepcion.reset({
      fecha: this.hoy(),
      tipo: 'CERRADA',
      horaInicio: '10:00',
      horaFin: '14:00',
      motivo: '',
    });
    this.modalExcepcion.set(true);
  }

  cerrarExcepcion(): void {
    if (this.guardandoExcepcion()) return;
    this.modalExcepcion.set(false);
  }

  /**
   * La excepción es de UNA fecha: el backend guarda una fila por
   * `(barbero, barbería, fecha)` y no acepta rangos.
   */
  registrarExcepcion(): void {
    const barberiaId = this.barberiaActivaId();
    const barberoId = this.authService.authState().user?.id;
    const { fecha, tipo, horaInicio, horaFin, motivo } = this.formExcepcion.getRawValue();

    if (!barberiaId || !barberoId) {
      this.errorExcepcion.set('No se pudo identificar tu sesión o la sede activa.');
      return;
    }

    if (!fecha) {
      this.errorExcepcion.set('Indica la fecha de la excepción.');
      return;
    }

    const payload: NuevaExcepcionBarbero = {
      fecha,
      tipo: tipo ?? 'CERRADA',
      motivo: motivo?.trim() || undefined,
    };

    if (payload.tipo === 'HORARIO_ESPECIAL') {
      if (!horaInicio || !horaFin) {
        this.errorExcepcion.set('Indica desde y hasta qué hora trabajarás ese día.');
        return;
      }
      if (this.aMinutos(horaInicio) >= this.aMinutos(horaFin)) {
        this.errorExcepcion.set('La hora de fin debe ser posterior a la de inicio.');
        return;
      }
      payload.horaInicio = horaInicio;
      payload.horaFin = horaFin;
    }

    this.guardandoExcepcion.set(true);
    this.errorExcepcion.set(null);

    this.horariosService
      .crearExcepcionBarbero(barberiaId, barberoId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.guardandoExcepcion.set(false);
          this.modalExcepcion.set(false);
          this.toast.success(
            `Excepción registrada para el ${fecha}.`,
            'Horario actualizado',
          );
        },
        error: () => {
          this.guardandoExcepcion.set(false);
          this.errorExcepcion.set('No se pudo registrar la excepción.');
        },
      });
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private aplicarPlantilla(plantilla: PlantillaBaseSemana): void {
    const porDia = new Map((plantilla?.dias ?? []).map((dia) => [dia.diaSemana, dia]));

    this.dias.clear();
    for (const base of PLANTILLA_POR_DEFECTO) {
      const guardado = porDia.get(base.diaSemana);
      this.dias.push(
        this.construirDia(
          guardado
            ? {
                diaSemana: base.diaSemana,
                // Un día sin horas guardadas conserva las de la propuesta para
                // que encenderlo no obligue a teclearlas.
                horaInicio: guardado.horaInicio ?? base.horaInicio,
                horaFin: guardado.horaFin ?? base.horaFin,
                activo: guardado.activo,
              }
            : base,
        ),
      );
    }

    this.sinPlantilla.set(plantilla?.sinPlantilla ?? true);
    this.erroresDia.set({});
    this.errorGuardado.set(null);
  }

  private construirDia(dia: DiaPlantillaBase): FormGroup {
    return this.fb.group({
      diaSemana: [dia.diaSemana],
      activo: [dia.activo],
      horaInicio: [
        { value: dia.horaInicio ?? '09:00', disabled: !dia.activo },
        [Validators.required],
      ],
      horaFin: [
        { value: dia.horaFin ?? '19:00', disabled: !dia.activo },
        [Validators.required],
      ],
    });
  }

  /** Misma regla que el backend y que el CHECK de la base: entrada < salida. */
  private validarPlantilla(): Record<number, string> {
    const errores: Record<number, string> = {};

    for (const grupo of this.dias.controls) {
      if (!grupo.get('activo')?.value) continue;

      const diaSemana = grupo.get('diaSemana')?.value as number;
      const inicio = grupo.get('horaInicio')?.value as string;
      const fin = grupo.get('horaFin')?.value as string;

      if (!inicio || !fin) {
        errores[diaSemana] = 'Indica la hora de entrada y la de salida.';
        continue;
      }
      if (this.aMinutos(inicio) >= this.aMinutos(fin)) {
        errores[diaSemana] = 'La salida debe ser posterior a la entrada.';
      }
    }

    return errores;
  }

  private limpiarErrorDia(grupo: AbstractControl): void {
    const diaSemana = grupo.get('diaSemana')?.value as number;
    const actuales = { ...this.erroresDia() };
    if (!actuales[diaSemana]) return;

    delete actuales[diaSemana];
    this.erroresDia.set(actuales);
    if (Object.keys(actuales).length === 0) this.errorGuardado.set(null);
  }

  private aMinutos(hora: string): number {
    const [hh, mm] = hora.split(':').map(Number);
    return hh * 60 + mm;
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private barberiaActivaId(): string | null {
    return this.tenantService.barberiaActiva()?.id ?? null;
  }
}
