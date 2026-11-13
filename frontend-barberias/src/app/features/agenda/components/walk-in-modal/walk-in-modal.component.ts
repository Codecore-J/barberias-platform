import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ReservasService } from '../../../../core/services/reservas.service';
import { mensajeDeError } from '../../../../core/utils/error-message';
import { ModalShellComponent } from '../../../../shared/ui/modal-shell/modal-shell.component';
import type { Personal } from '../../../../core/services/personal.service';
import type { Servicio } from '../../../../core/services/servicios.service';

/**
 * E3-03 · alta manual de un cliente sin app («walk-in») desde la agenda.
 *
 * Existía el disparador —`mostrarModalWalkIn.set(true)` en la consola— pero
 * ningún template consumía la señal: el botón Walk-In no abría nada. Este
 * componente es el consumidor que faltaba.
 *
 * Reglas que respeta:
 *  - El caminante SIEMPRE lleva barbero (`barberoId` obligatorio): es lo que
 *    distingue este flujo del wizard del cliente, donde el cupo puede quedar
 *    sin asignar.
 *  - El precio y la duración NO se teclean: salen del servicio elegido. El
 *    backend los recalcula igualmente; aquí solo se anticipa el total que se
 *    enviará como `precioTotalEsperado`.
 *  - `horaFin` se deriva de la duración. Si la suma cruza la medianoche se
 *    bloquea el envío: el contrato exige `HH:mm` del mismo día.
 *  - Un error del backend se muestra tal cual (409 hueco ocupado, 403 otra
 *    sede, 422 barbero inactivo…), nunca se simula éxito.
 */
@Component({
  selector: 'app-walk-in-modal',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, ModalShellComponent],
  template: `
    <app-modal-shell
      [visible]="true"
      titulo="Nuevo turno Walk-In"
      subtitulo="Cliente sin app · se agenda y se cobra desde la agenda"
      icono="pi pi-user-plus"
      tono="primario"
      [cerrarBloqueado]="enviando()"
      (cerrar)="cerrar.emit()"
    >
      <div class="space-y-4">
        <!-- Resumen del día -->
        <div class="rounded-2xl bg-zinc-950/70 border border-white/5 p-3 flex items-center justify-between text-xs">
          <span class="text-zinc-400">Fecha del turno</span>
          <span class="font-semibold text-zinc-100 font-mono">{{ fecha() }}</span>
        </div>

        <!-- Cliente -->
        <div class="space-y-1.5">
          <label for="walkin-nombre" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
            Nombre del cliente
          </label>
          <input
            id="walkin-nombre"
            type="text"
            [value]="nombre()"
            (input)="nombre.set($any($event.target).value)"
            [disabled]="enviando()"
            placeholder="Ej. Juan Pérez (sin cuenta)"
            autocomplete="off"
            class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-60"
          />
        </div>

        <!-- Barbero -->
        <div class="space-y-1.5">
          <label for="walkin-barbero" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
            Barbero
          </label>
          @if (staff().length === 0) {
            <p class="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              Esta sede no tiene barberos activos. Invita o activa a un miembro del personal antes de
              registrar un walk-in.
            </p>
          } @else {
            <select
              id="walkin-barbero"
              [value]="barberoId() ?? ''"
              (change)="barberoId.set($any($event.target).value || null)"
              [disabled]="enviando()"
              class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-60"
            >
              <option value="">Selecciona un barbero</option>
              @for (persona of staff(); track persona.id) {
                <option [value]="persona.id">{{ persona.nombreCompleto }}</option>
              }
            </select>
          }
        </div>

        <!-- Servicio -->
        <div class="space-y-1.5">
          <label for="walkin-servicio" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
            Servicio
          </label>
          @if (servicios().length === 0) {
            <p class="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              El catálogo de esta sede no tiene servicios activos. Crea uno en «Servicios» para poder
              agendar un walk-in.
            </p>
          } @else {
            <select
              id="walkin-servicio"
              [value]="servicioId() ?? ''"
              (change)="servicioId.set($any($event.target).value || null)"
              [disabled]="enviando()"
              class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-60"
            >
              <option value="">Selecciona un servicio</option>
              @for (servicio of servicios(); track servicio.id) {
                <option [value]="servicio.id">
                  {{ servicio.nombre }} · {{ servicio.duracionMinutos }} min ·
                  {{ servicio.precio | currency: 'USD' : 'symbol' : '1.2-2' }}
                </option>
              }
            </select>
          }
        </div>

        <!-- Hora de inicio -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label for="walkin-hora" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">
              Hora de inicio
            </label>
            <input
              id="walkin-hora"
              type="time"
              [value]="horaInicio()"
              (input)="horaInicio.set($any($event.target).value)"
              [disabled]="enviando()"
              class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-60"
            />
          </div>
          <div class="space-y-1.5">
            <span class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1 block">Termina</span>
            <div
              class="w-full bg-zinc-950/60 border border-white/5 rounded-xl py-2.5 px-4 text-sm font-mono"
              [class.text-zinc-500]="!horaFin()"
              [class.text-zinc-100]="!!horaFin()"
            >
              {{ horaFin() || '—' }}
            </div>
          </div>
        </div>

        @if (cruzaMedianoche()) {
          <div class="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-start gap-2" role="alert">
            <i class="pi pi-exclamation-triangle mt-0.5"></i>
            <span>Con esa hora el turno terminaría después de medianoche. Elige una hora más temprana.</span>
          </div>
        }

        <!-- Total derivado del catálogo -->
        @if (servicioSeleccionado(); as servicio) {
          <div class="rounded-2xl bg-zinc-950/70 border border-white/5 p-4 space-y-1.5">
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-400">Servicio</span>
              <span class="font-medium text-zinc-200">{{ servicio.nombre }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-400">Duración</span>
              <span class="font-medium text-zinc-200">{{ servicio.duracionMinutos }} min</span>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-white/5">
              <span class="text-xs uppercase tracking-wider text-zinc-400 font-semibold">Total a cobrar</span>
              <span class="text-xl font-bold text-emerald-400">
                {{ precio() | currency: 'USD' : 'symbol' : '1.2-2' }}
              </span>
            </div>
          </div>
        }

        @if (error()) {
          <div class="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-start gap-2" role="alert">
            <i class="pi pi-exclamation-triangle mt-0.5"></i>
            <span>{{ error() }}</span>
          </div>
        }

        <p class="text-[11px] text-zinc-500 leading-relaxed">
          El turno se crea en estado pendiente. Cóbralo desde su tarjeta en la agenda para que entre
          en la caja del día.
        </p>
      </div>

      <div modal-footer class="flex gap-3 pt-4 border-t border-white/5">
        <button
          type="button"
          (click)="cerrar.emit()"
          [disabled]="enviando()"
          class="flex-1 py-3 rounded-xl font-medium text-sm text-zinc-300 bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="button"
          (click)="crear()"
          [disabled]="!puedeEnviar()"
          class="flex-1 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          @if (enviando()) {
            <i class="pi pi-spin pi-spinner"></i> Agendando...
          } @else {
            <i class="pi pi-check"></i> Crear turno
          }
        </button>
      </div>
    </app-modal-shell>
  `,
})
export class WalkInModalComponent {
  private readonly reservasService = inject(ReservasService);

  /** Día que está mirando la agenda; el turno nace en ese día, no en «hoy». */
  readonly fecha = input.required<string>();
  /** Equipo asignable de la sede (ya filtrado por estado y rol). */
  readonly staff = input<Personal[]>([]);
  /** Catálogo activo de la sede. */
  readonly servicios = input<Servicio[]>([]);

  readonly creado = output<void>();
  readonly cerrar = output<void>();

  readonly nombre = signal('');
  readonly barberoId = signal<string | null>(null);
  readonly servicioId = signal<string | null>(null);
  readonly horaInicio = signal(this.horaRedondeada());
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  readonly servicioSeleccionado = computed<Servicio | null>(() => {
    const id = this.servicioId();
    if (!id) return null;
    return this.servicios().find((s) => s.id === id) ?? null;
  });

  readonly duracionMinutos = computed(() => this.servicioSeleccionado()?.duracionMinutos ?? 0);
  readonly precio = computed(() => Number(this.servicioSeleccionado()?.precio ?? 0));

  /** `HH:mm` de fin, o `null` si aún no hay hora o servicio. */
  readonly horaFin = computed<string | null>(() => {
    const inicio = this.horaInicio();
    const duracion = this.duracionMinutos();
    if (!inicio || duracion <= 0) return null;
    const [h, m] = inicio.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const total = h * 60 + m + duracion;
    const minutosDelDia = total % (24 * 60);
    return `${String(Math.floor(minutosDelDia / 60)).padStart(2, '0')}:${String(minutosDelDia % 60).padStart(2, '0')}`;
  });

  /** El contrato exige inicio y fin del mismo día: sin margen para el cruce. */
  readonly cruzaMedianoche = computed(() => {
    const inicio = this.horaInicio();
    const fin = this.horaFin();
    if (!inicio || !fin) return false;
    return fin <= inicio;
  });

  readonly puedeEnviar = computed(
    () =>
      !this.enviando() &&
      this.nombre().trim().length > 0 &&
      !!this.barberoId() &&
      !!this.servicioSeleccionado() &&
      !!this.horaInicio() &&
      !!this.horaFin() &&
      !this.cruzaMedianoche(),
  );

  crear(): void {
    if (!this.puedeEnviar()) return;

    const barberoId = this.barberoId();
    const servicio = this.servicioSeleccionado();
    const horaFin = this.horaFin();
    if (!barberoId || !servicio || !horaFin) return;

    this.enviando.set(true);
    this.error.set(null);

    this.reservasService
      .crearReservaWalkIn({
        fecha: this.fecha(),
        horaInicio: this.horaInicio(),
        horaFin,
        serviciosIds: [servicio.id],
        precioTotalEsperado: this.precio(),
        barberoId,
        nombreInvitado: this.nombre().trim(),
        tipo: 'INDIVIDUAL',
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.creado.emit();
        },
        error: (err) => {
          this.enviando.set(false);
          this.error.set(this.mensajeDeError(err));
        },
      });
  }

  private mensajeDeError(err: any): string {
    const backend = mensajeDeError(err, '');
    if (backend) return backend;

    switch (err?.status) {
      case 409:
        return 'Ese hueco ya está ocupado para el barbero elegido. Prueba otra hora.';
      case 403:
        return 'No tienes permiso para agendar en esta sede.';
      case 422:
        return 'El barbero no está disponible: revisa su estado o su horario en esta sede.';
      case 400:
        return 'Los datos del turno no son válidos. Revisa el servicio y las horas.';
      default:
        return 'No se pudo crear el turno. Intenta de nuevo.';
    }
  }

  /** Hora actual redondeada al siguiente cuarto de hora, como punto de partida. */
  private horaRedondeada(): string {
    const ahora = new Date();
    const minutos = Math.ceil(ahora.getMinutes() / 15) * 15;
    const total = (ahora.getHours() * 60 + minutos) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
}
