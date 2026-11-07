import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../auth/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import {
  EstadoSolicitudCambio,
  MOTIVO_RECHAZO_MIN,
  SolicitudCambio,
  SolicitudesCambioService,
} from '../../../core/services/solicitudes-cambio.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ModalShellComponent } from '../../../shared/ui/modal-shell/modal-shell.component';
import { ToastService } from '../../../shared/ui/toast/toast.service';

type FiltroEstado = 'TODAS' | EstadoSolicitudCambio;

/**
 * E3-13 · solicitudes de cambio de nombre y responsable (D26).
 *
 * Una sola pantalla para las dos mitades del flujo, porque el reparto de poder
 * es el que manda:
 *
 *  - el ADMIN_BARBERIA ve lo que su sede propuso y cómo terminó (el backend no
 *    le da verbo de resolución: la sede PROPONE);
 *  - el ADMINISTRADOR global ve la bandeja de plataforma —de una sede o de
 *    todas— y es el único que aprueba o rechaza.
 *
 * El estado no se duplica: se pinta lo que devuelve el servicio y la fila se
 * sustituye en el sitio cuando el backend confirma. El `tenantGuard` garantiza
 * que hay sede activa antes de entrar.
 */
@Component({
  selector: 'app-admin-solicitudes-cambio',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, ModalShellComponent],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div
            class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1"
          >
            <i class="pi" [ngClass]="esGlobal() ? 'pi-shield' : 'pi-send'"></i>
            <span>{{ esGlobal() ? 'Gobernanza de plataforma' : 'Propuestas de la sede' }}</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">
            Solicitudes de <span class="gold-gradient-text">cambio</span>
          </h2>
          <p class="text-sm text-zinc-400">
            {{
              esGlobal()
                ? 'El nombre y el responsable de una sede solo cambian con la aprobación de la plataforma'
                : 'Aquí ves el estado de lo que propusiste; la decisión final es de la plataforma'
            }}
          </p>
        </div>

        <button
          (click)="cargar()"
          class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2"
        >
          <i class="pi pi-refresh" [class.pi-spin]="servicio.isLoading()"></i> Refrescar
        </button>
      </div>

      <!-- Métricas -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Pendientes</p>
            <p class="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{{ pendientes() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-hourglass text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Aprobadas</p>
            <p class="text-xl sm:text-2xl font-bold text-emerald-400 mt-1">{{ aprobadas() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <i class="pi pi-check-circle text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between col-span-2 sm:col-span-1">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Rechazadas</p>
            <p class="text-xl sm:text-2xl font-bold text-rose-400 mt-1">{{ rechazadas() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <i class="pi pi-times-circle text-lg"></i>
          </div>
        </div>
      </div>

      <!-- Alcance (solo plataforma) y filtros -->
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        @if (esGlobal()) {
          <label class="flex items-center gap-3 text-xs text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              [ngModel]="soloSede()"
              (ngModelChange)="cambiarAlcance($event)"
              class="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-amber-500"
            />
            <span>
              Solo la sede activa
              <span class="text-zinc-500">
                ({{ barberiaActiva()?.nombre ?? 'sin sede' }})
              </span>
            </span>
          </label>
        } @else {
          <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2 max-w-xl">
            <i class="pi pi-info-circle mt-0.5"></i>
            <span>
              Esta bandeja es de <span class="font-semibold">solo lectura</span>: tu propuesta la
              resuelve la plataforma. Cuando responda, el estado aparece aquí.
            </span>
          </div>
        }

        <div class="flex flex-wrap gap-2">
          @for (opcion of filtros; track opcion.valor) {
            <button
              type="button"
              (click)="filtro.set(opcion.valor)"
              class="px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all"
              [ngClass]="
                filtro() === opcion.valor
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-zinc-900/60 border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20'
              "
            >
              {{ opcion.etiqueta }}
              <span class="ml-1 text-[10px] text-zinc-500">{{ contar(opcion.valor) }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Feedback -->
      @if (servicio.error()) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <i class="pi pi-exclamation-triangle"></i> {{ servicio.error() }}
        </div>
      }

      <!-- Carga -->
      @if (servicio.isLoading() && servicio.solicitudes().length === 0) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Tabla -->
      @if (!servicio.isLoading() || servicio.solicitudes().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-xl">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/60">
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cambio pedido</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Sede</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Solicitado</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Estado</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">
                    {{ esGlobal() ? 'Resolución' : 'Seguimiento' }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (fila of visibles(); track fila.id) {
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="p-4">
                      <span class="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                        {{ fila.tipo === 'NOMBRE' ? 'Nombre' : 'Responsable' }}
                      </span>
                      @if (fila.tipo === 'NOMBRE') {
                        <div class="font-bold text-white mt-0.5">{{ fila.valorNuevo }}</div>
                      } @else {
                        <div class="font-mono text-zinc-200 mt-0.5" [title]="fila.valorNuevo">
                          {{ corto(fila.valorNuevo) }}
                        </div>
                      }
                      <div class="text-[10px] text-zinc-600 font-mono mt-0.5">{{ corto(fila.id) }}</div>
                    </td>
                    <td class="p-4">
                      <div class="text-zinc-200 font-medium">
                        {{ fila.barberia?.nombre ?? barberiaActiva()?.nombre ?? '—' }}
                      </div>
                    </td>
                    <td class="p-4 text-zinc-400">
                      <div>{{ fila.creadoAt ? (fila.creadoAt | date: 'dd MMM yyyy · HH:mm') : '—' }}</div>
                      <div class="text-[10px] text-zinc-600 font-mono mt-0.5" [title]="fila.solicitadoPor">
                        por {{ corto(fila.solicitadoPor) }}
                      </div>
                    </td>
                    <td class="p-4">
                      <span
                        class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5"
                        [ngClass]="claseEstado(fila.estado)"
                      >
                        <i class="pi" [ngClass]="iconoEstado(fila.estado)"></i>
                        {{ fila.estado }}
                      </span>
                      @if (fila.motivoRechazo) {
                        <p class="text-[11px] text-rose-300/80 mt-1.5 max-w-[220px]">{{ fila.motivoRechazo }}</p>
                      }
                      @if (fila.resueltoAt) {
                        <p class="text-[10px] text-zinc-600 mt-1">
                          {{ fila.resueltoAt | date: 'dd MMM yyyy · HH:mm' }}
                        </p>
                      }
                    </td>
                    <td class="p-4">
                      @if (esGlobal() && fila.estado === 'PENDIENTE') {
                        <div class="flex items-center justify-end gap-2">
                          <button
                            (click)="aprobar(fila)"
                            [disabled]="procesandoId() !== null"
                            class="px-3.5 py-2 rounded-xl font-bold text-xs text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-1.5"
                          >
                            <i
                              class="pi"
                              [ngClass]="procesandoId() === fila.id ? 'pi-spin pi-spinner' : 'pi-check'"
                            ></i>
                            Aprobar
                          </button>
                          <button
                            (click)="abrirRechazo(fila)"
                            [disabled]="procesandoId() !== null"
                            class="px-3.5 py-2 rounded-xl font-semibold text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5"
                          >
                            <i class="pi pi-times"></i> Rechazar
                          </button>
                        </div>
                      } @else if (fila.estado === 'PENDIENTE') {
                        <p class="text-right text-[11px] text-zinc-500">
                          Esperando a la plataforma
                        </p>
                      } @else {
                        <p class="text-right text-[11px] text-zinc-500">Resuelta</p>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (visibles().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-inbox text-5xl text-zinc-600 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">
                {{ filtro() === 'TODAS' ? 'No hay solicitudes de cambio' : 'No hay solicitudes en este estado' }}
              </p>
              <p class="text-xs text-zinc-500 mt-1">
                @if (esGlobal()) {
                  Las sedes proponen cambios de nombre o de responsable y aparecen aquí.
                } @else {
                  Cuando la sede proponga un cambio, aparecerá en esta bandeja.
                }
              </p>
            </div>
          }
        </div>
      }

      <!-- Modal de rechazo: el motivo es obligatorio (D26) -->
      @if (seleccionada(); as fila) {
        <app-modal-shell
          [visible]="true"
          titulo="Rechazar solicitud de cambio"
          [subtitulo]="(fila.barberia?.nombre ?? 'La sede') + ' · ' + (fila.tipo === 'NOMBRE' ? 'Nombre' : 'Responsable')"
          icono="pi pi-times-circle"
          tono="peligro"
          [cerrarBloqueado]="procesandoId() !== null"
          (cerrar)="cerrarModal()"
        >
          <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            La propuesta de <span class="font-semibold">{{ fila.valorNuevo }}</span> quedará
            <span class="font-semibold">RECHAZADA</span>. El motivo es obligatorio y queda auditado.
          </div>

          <div>
            <label for="solicitud-motivo-rechazo" class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo del rechazo</label>
            <textarea
              id="solicitud-motivo-rechazo"
              [(ngModel)]="motivo"
              rows="3"
              maxlength="500"
              class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="Explica por qué no se aprueba el cambio"
            ></textarea>
            <p class="text-[11px] mt-1.5" [ngClass]="motivoValido() ? 'text-zinc-500' : 'text-rose-400'">
              {{ motivoAyuda() }}
            </p>
          </div>

          <div modal-footer class="flex gap-3 pt-2 border-t border-zinc-800">
            <button
              (click)="cerrarModal()"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancelar
            </button>
            <button
              (click)="confirmarRechazo()"
              [disabled]="!motivoValido() || procesandoId() !== null"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              <i class="pi" [ngClass]="procesandoId() !== null ? 'pi-spin pi-spinner' : 'pi-ban'"></i>
              <span>Confirmar rechazo</span>
            </button>
          </div>
        </app-modal-shell>
      }
    </div>
  `,
})
export class AdminSolicitudesCambioComponent implements OnInit {
  protected readonly servicio = inject(SolicitudesCambioService);
  protected readonly barberiaActiva = inject(TenantService).barberiaActiva;
  protected readonly MOTIVO_RECHAZO_MIN = MOTIVO_RECHAZO_MIN;
  protected readonly filtros: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'TODAS', etiqueta: 'Todas' },
    { valor: 'PENDIENTE', etiqueta: 'Pendientes' },
    { valor: 'APROBADA', etiqueta: 'Aprobadas' },
    { valor: 'RECHAZADA', etiqueta: 'Rechazadas' },
  ];

  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly toast = inject(ToastService);
  private readonly dialogo = inject(ConfirmDialogService);

  readonly filtro = signal<FiltroEstado>('TODAS');
  readonly soloSede = signal(true);
  readonly procesandoId = signal<string | null>(null);
  readonly seleccionada = signal<SolicitudCambio | null>(null);
  readonly motivo = signal('');

  /** El global resuelve; la sede solo mira. Lo dice el rol del JWT, no la ruta. */
  readonly esGlobal = computed(() =>
    (this.auth.authState().user?.roles ?? []).includes('ADMINISTRADOR'),
  );

  readonly pendientes = computed(
    () => this.servicio.solicitudes().filter((fila) => fila.estado === 'PENDIENTE').length,
  );

  readonly aprobadas = computed(
    () => this.servicio.solicitudes().filter((fila) => fila.estado === 'APROBADA').length,
  );

  readonly rechazadas = computed(
    () => this.servicio.solicitudes().filter((fila) => fila.estado === 'RECHAZADA').length,
  );

  readonly visibles = computed(() => {
    const seleccion = this.filtro();
    const lista = this.servicio.solicitudes();
    return seleccion === 'TODAS' ? lista : lista.filter((fila) => fila.estado === seleccion);
  });

  readonly motivoValido = computed(() => this.motivo().trim().length >= MOTIVO_RECHAZO_MIN);

  /**
   * H-05: el contador crudo («48/5») se lee como una fracción —más del mínimo,
   * pero con aspecto de «48 de 5»— y el número suelto no dice qué se cuenta.
   * En lenguaje llano: cuántos caracteres hay y, si aún no llega, cuántos
   * faltan. En singular para no escribir «1 caracteres».
   */
  readonly motivoAyuda = computed(() => {
    const escritos = this.motivo().trim().length;
    const recuento = escritos === 1 ? '1 carácter' : `${escritos} caracteres`;
    return escritos >= MOTIVO_RECHAZO_MIN
      ? `${recuento} (mínimo ${MOTIVO_RECHAZO_MIN})`
      : `${recuento} · faltan ${MOTIVO_RECHAZO_MIN - escritos}`;
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const barberiaId = this.tenant.barberiaActivaId();

    if (this.esGlobal()) {
      this.servicio
        .cargarDePlataforma(this.soloSede() ? barberiaId : null)
        .subscribe({ error: () => undefined });
      return;
    }

    // El `tenantGuard` ya exige sede activa; sin ella no hay bandeja que pedir.
    if (!barberiaId) {
      return;
    }
    this.servicio.cargarDeSede(barberiaId).subscribe({ error: () => undefined });
  }

  /** Alternar entre la sede activa y todas las sedes (solo plataforma). */
  cambiarAlcance(soloSede: boolean): void {
    this.soloSede.set(soloSede);
    this.cargar();
  }

  contar(valor: FiltroEstado): number {
    const lista = this.servicio.solicitudes();
    return valor === 'TODAS' ? lista.length : lista.filter((fila) => fila.estado === valor).length;
  }

  async aprobar(fila: SolicitudCambio): Promise<void> {
    const sede = fila.barberia?.nombre ?? this.barberiaActiva()?.nombre ?? 'la sede';
    const confirmado = await this.dialogo.confirm({
      titulo: 'Aprobar solicitud de cambio',
      mensaje:
        fila.tipo === 'NOMBRE'
          ? `La sede ${sede} pasará a llamarse «${fila.valorNuevo}».`
          : `El responsable de ${sede} pasará a ser el usuario ${this.corto(fila.valorNuevo)}.`,
      textoConfirmar: 'Aprobar',
      icono: 'pi pi-check-circle',
    });

    if (!confirmado) {
      return;
    }

    this.procesandoId.set(fila.id);
    this.servicio.resolver(fila.id, true).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.toast.success('Solicitud aprobada: el cambio ya está aplicado.', 'Solicitudes de cambio');
      },
      error: (err) => {
        this.procesandoId.set(null);
        this.toast.error(this.mensajeDe(err), 'Solicitudes de cambio');
      },
    });
  }

  abrirRechazo(fila: SolicitudCambio): void {
    this.seleccionada.set(fila);
    this.motivo.set('');
  }

  cerrarModal(): void {
    this.seleccionada.set(null);
    this.motivo.set('');
  }

  confirmarRechazo(): void {
    const fila = this.seleccionada();
    if (!fila || !this.motivoValido()) {
      return;
    }

    this.procesandoId.set(fila.id);
    this.servicio.resolver(fila.id, false, this.motivo().trim()).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.cerrarModal();
        this.toast.success('Solicitud rechazada: el motivo quedó auditado.', 'Solicitudes de cambio');
      },
      error: (err) => {
        this.procesandoId.set(null);
        this.toast.error(this.mensajeDe(err), 'Solicitudes de cambio');
      },
    });
  }

  /** Los ids completos no caben en una celda; el `title` conserva el valor íntegro. */
  corto(id: string): string {
    return id ? `${id.slice(0, 8)}…` : '—';
  }

  claseEstado(estado: EstadoSolicitudCambio): string {
    switch (estado) {
      case 'APROBADA':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25';
      case 'RECHAZADA':
        return 'bg-rose-500/10 text-rose-300 border-rose-500/25';
      default:
        return 'bg-amber-500/10 text-amber-300 border-amber-500/25';
    }
  }

  iconoEstado(estado: EstadoSolicitudCambio): string {
    switch (estado) {
      case 'APROBADA':
        return 'pi-check-circle';
      case 'RECHAZADA':
        return 'pi-times-circle';
      default:
        return 'pi-clock';
    }
  }

  private mensajeDe(err: unknown): string {
    const cuerpo = (err as { error?: { mensaje?: string; message?: string } })?.error;
    return cuerpo?.mensaje || cuerpo?.message || 'No se pudo resolver la solicitud';
  }
}
