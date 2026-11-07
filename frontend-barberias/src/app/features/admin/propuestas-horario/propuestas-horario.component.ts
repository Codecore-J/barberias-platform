import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TenantService } from '../../../core/services/tenant.service';
import {
  PropuestaHorarioPendiente,
  PropuestasHorarioService,
} from '../../../core/services/propuestas-horario.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';
import { mensajeDeError } from '../../../core/utils/error-message';

/**
 * H-03 · bandeja dedicada de propuestas de horario (D18/§5.4).
 *
 * Antes, una propuesta del cliente solo se veía entrando al día de la cita y
 * leyendo el estado de la reserva. Aquí llega ya filtrada por el backend
 * (`estado = PENDIENTE`) con la cita actual y el bloque propuesto, así que la
 * sede decide sin abrir la agenda.
 *
 * Aprobar reutiliza la transacción de E3-08: revalida el hueco bajo el lock de
 * la sede, mueve la cita y marca la propuesta ACEPTADA. Rechazar solo cierra la
 * propuesta. En ambos casos la fila sale de la lista y la señal `revision` del
 * servicio invalida la vista de agenda que se vuelva a montar.
 */
@Component({
  selector: 'app-propuestas-horario',
  standalone: true,
  imports: [CommonModule, DatePipe, TableModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-7xl mx-auto space-y-8 bg-ambient-mesh">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div
            class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1"
          >
            <i class="pi pi-clock"></i>
            <span>Cambios de horario</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">
            Propuestas <span class="gold-gradient-text">pendientes</span>
          </h2>
          <p class="text-sm text-zinc-400">
            Los clientes proponen un bloque nuevo y la sede decide: al aprobar, la cita se mueve
            al horario propuesto; al rechazar, conserva el actual.
          </p>
        </div>

        <button
          type="button"
          (click)="cargar()"
          class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2"
        >
          <i class="pi pi-refresh" [class.pi-spin]="servicio.isLoading()"></i> Refrescar
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Pendientes</p>
            <p class="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{{ total() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-inbox text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Vencidas</p>
            <p class="text-xl sm:text-2xl font-bold text-rose-400 mt-1">{{ vencidas() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <i class="pi pi-hourglass text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between col-span-2 sm:col-span-1">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Barberos afectados</p>
            <p class="text-xl sm:text-2xl font-bold text-sky-400 mt-1">{{ barberosAfectados() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <i class="pi pi-user text-lg"></i>
          </div>
        </div>
      </div>

      @if (servicio.error(); as error) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
          <i class="pi pi-exclamation-triangle mt-0.5"></i>
          <span>{{ error }}</span>
        </div>
      }

      <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-xl">
        <p-table
          [value]="servicio.propuestas()"
          dataKey="id"
          [loading]="servicio.isLoading()"
          [paginator]="servicio.propuestas().length > 10"
          [rows]="10"
          [rowsPerPageOptions]="[10, 20, 50]"
          styleClass="propuestas-table"
        >
          <ng-template #header>
            <tr>
              <th class="whitespace-nowrap">Personal / Cliente</th>
              <th class="whitespace-nowrap">Horario actual</th>
              <th class="whitespace-nowrap">Horario propuesto</th>
              <th class="whitespace-nowrap">Motivo</th>
              <th class="whitespace-nowrap">Solicitud</th>
              <th class="text-right whitespace-nowrap">Acciones</th>
            </tr>
          </ng-template>

          <ng-template #body let-propuesta>
            <tr>
              <td>
                <div class="font-semibold text-zinc-100">
                  {{ propuesta.reserva.barbero?.nombre ?? 'Sin barbero asignado' }}
                </div>
                <div class="text-[11px] text-zinc-400 mt-0.5">
                  Cliente: {{ propuesta.reserva.cliente.nombre }}
                </div>
                <div class="text-[10px] text-zinc-600 font-mono" [title]="propuesta.reservaId">
                  {{ propuesta.reservaId.slice(0, 8) }}
                </div>
              </td>

              <td>
                <div class="text-zinc-200 font-medium">{{ fecha(propuesta.reserva.fechaActual) }}</div>
                <div class="text-[11px] text-zinc-400">
                  {{ propuesta.reserva.horaInicioActual }} – {{ propuesta.reserva.horaFinActual }}
                </div>
              </td>

              <td>
                <div class="text-amber-300 font-semibold">
                  {{ fecha(propuesta.fechaPropuesta) }}
                </div>
                <div class="text-[11px] text-amber-200/80">
                  {{ propuesta.horaInicioPropuesta }} – {{ propuesta.horaFinPropuesta }}
                </div>
              </td>

              <td>
                <span class="text-[11px] text-zinc-300">{{ propuesta.motivo }}</span>
                <div class="text-[10px] text-zinc-600 mt-0.5">por {{ propuesta.solicitante.nombre }}</div>
              </td>

              <td>
                <div class="text-[11px] text-zinc-300">
                  {{ propuesta.creadoAt ? (propuesta.creadoAt | date: 'dd MMM yyyy · HH:mm') : '—' }}
                </div>
                @if (estaExpirada(propuesta)) {
                  <span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-400 mt-1">
                    <i class="pi pi-times-circle"></i> Vencida
                  </span>
                } @else if (propuesta.expiraAt) {
                  <div class="text-[10px] text-zinc-500 mt-0.5">
                    Vence {{ propuesta.expiraAt | date: 'HH:mm' }} · {{ minutosRestantes(propuesta) }} min
                  </div>
                }
              </td>

              <td>
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    (click)="aprobar(propuesta)"
                    [disabled]="procesando() || estaExpirada(propuesta)"
                    class="px-3.5 py-2 rounded-xl font-bold text-xs text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                  >
                    <i class="pi" [ngClass]="servicio.procesandoId() === propuesta.id ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                    Aprobar
                  </button>
                  <button
                    type="button"
                    (click)="rechazar(propuesta)"
                    [disabled]="procesando() || estaExpirada(propuesta)"
                    class="px-3.5 py-2 rounded-xl font-semibold text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                  >
                    <i class="pi pi-times"></i>
                    Rechazar
                  </button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template #emptymessage>
            <tr>
              <td colspan="6">
                <div class="py-14 text-center">
                  <i class="pi pi-check-circle text-3xl text-emerald-500/70 mb-3 block"></i>
                  <p class="text-sm font-semibold text-zinc-300">No hay propuestas pendientes</p>
                  <p class="text-xs text-zinc-500 mt-1">
                    Cuando un cliente proponga otro horario para su cita, aparecerá aquí.
                  </p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .propuestas-table .p-datatable-table-container {
        overflow-x: auto;
      }
      :host ::ng-deep .propuestas-table table {
        min-width: 980px;
      }
      :host ::ng-deep .propuestas-table thead th {
        background: rgba(24, 24, 27, 0.75);
        color: #d4af37;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        border-color: rgba(255, 255, 255, 0.06);
        padding: 1rem;
      }
      :host ::ng-deep .propuestas-table tbody td {
        background: transparent;
        border-color: rgba(255, 255, 255, 0.05);
        padding: 1rem;
        vertical-align: top;
        font-size: 12px;
      }
      :host ::ng-deep .propuestas-table tbody tr:hover td {
        background: rgba(255, 255, 255, 0.03);
      }
    `,
  ],
})
export class AdminPropuestasHorarioComponent implements OnInit {
  protected readonly servicio = inject(PropuestasHorarioService);
  private readonly tenant = inject(TenantService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly total = computed(() => this.servicio.propuestas().length);
  readonly vencidas = computed(
    () => this.servicio.propuestas().filter((p) => this.estaExpirada(p)).length,
  );
  readonly barberosAfectados = computed(
    () =>
      new Set(
        this.servicio.propuestas()
          .map((p) => p.reserva.barbero?.id)
          .filter((id): id is string => !!id),
      ).size,
  );

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    if (!this.tenant.barberiaActivaId()) {
      return;
    }
    this.servicio.cargar().subscribe({ error: () => undefined });
  }

  async aprobar(propuesta: PropuestaHorarioPendiente): Promise<void> {
    const ok = await this.confirm.confirm({
      titulo: 'Aprobar cambio de horario',
      mensaje: `La cita de ${propuesta.reserva.cliente.nombre} pasará al ${this.fecha(
        propuesta.fechaPropuesta,
      )} de ${propuesta.horaInicioPropuesta} a ${propuesta.horaFinPropuesta}. El backend revalidará que el hueco siga libre.`,
      textoConfirmar: 'Aprobar',
      icono: 'pi pi-check-circle',
    });

    if (!ok) return;

    this.servicio.aprobar(propuesta).subscribe({
      next: () => {
        this.toast.success(
          `La cita se movió al ${this.fecha(propuesta.fechaPropuesta)} a las ${propuesta.horaInicioPropuesta}.`,
          'Propuesta aprobada',
        );
      },
      error: (err) => {
        this.toast.error(
          mensajeDeError(err, 'No se pudo aprobar la propuesta'),
          'Propuesta no aprobada',
        );
        // Un 409 puede significar que el hueco se ocupó o que la propuesta venció:
        // se recarga para que la bandeja refleje el estado real.
        this.cargar();
      },
    });
  }

  async rechazar(propuesta: PropuestaHorarioPendiente): Promise<void> {
    const ok = await this.confirm.confirm({
      titulo: 'Rechazar cambio de horario',
      mensaje: `La cita de ${propuesta.reserva.cliente.nombre} conservará su horario actual (${this.fecha(
        propuesta.reserva.fechaActual,
      )} de ${propuesta.reserva.horaInicioActual} a ${propuesta.reserva.horaFinActual}).`,
      textoConfirmar: 'Rechazar',
      tono: 'peligro',
      icono: 'pi pi-times-circle',
    });

    if (!ok) return;

    this.servicio.rechazar(propuesta).subscribe({
      next: () => {
        this.toast.info('La cita conserva su horario actual.', 'Propuesta rechazada');
      },
      error: (err) => {
        this.toast.error(
          mensajeDeError(err, 'No se pudo rechazar la propuesta'),
          'Propuesta no rechazada',
        );
        this.cargar();
      },
    });
  }

  procesando(): boolean {
    return this.servicio.procesandoId() !== null;
  }

  estaExpirada(propuesta: PropuestaHorarioPendiente): boolean {
    if (propuesta.expirada) return true;
    return !!propuesta.expiraAt && new Date(propuesta.expiraAt).getTime() <= Date.now();
  }

  minutosRestantes(propuesta: PropuestaHorarioPendiente): number {
    if (!propuesta.expiraAt) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.ceil((new Date(propuesta.expiraAt).getTime() - Date.now()) / 60000));
  }

  /** `YYYY-MM-DD` → `dd MMM yyyy`, sin que la zona horaria mueva el día. */
  fecha(iso: string): string {
    if (!iso) return '—';
    const [anio, mes, dia] = iso.slice(0, 10).split('-').map(Number);
    if (!anio || !mes || !dia) return iso;
    return new Date(anio, mes - 1, dia).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
