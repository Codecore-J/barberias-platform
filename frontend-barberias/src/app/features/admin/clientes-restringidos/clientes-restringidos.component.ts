import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TenantService } from '../../../core/services/tenant.service';
import {
  ClienteRestringido,
  ClientesRestringidosService,
} from '../../../core/services/clientes-restringidos.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * E4-03 · lista de restringidos de la SEDE (D48).
 *
 * La penalización por inasistencias es local: reactivar aquí devuelve al cliente
 * el derecho a agendar en ESTA barbería y reinicia su contador, pero no toca su
 * cuenta de plataforma —suspenderla es una decisión del ADMINISTRADOR global—.
 * La pantalla no inventa fechas: la fila no guarda cuándo se restringió, así que
 * muestra el alta del vínculo con su etiqueta correcta.
 */
@Component({
  selector: 'app-admin-clientes-restringidos',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div
            class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1"
          >
            <i class="pi pi-shield"></i>
            <span>Seguridad de la sede</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">
            Clientes <span class="gold-gradient-text">restringidos</span>
          </h2>
          <p class="text-sm text-zinc-400">
            Quién no puede agendar en {{ barberiaActiva()?.nombre ?? 'esta sede' }} y por qué
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
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Restringidos</p>
            <p class="text-xl sm:text-2xl font-bold text-rose-400 mt-1">{{ servicio.clientes().length }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <i class="pi pi-user-minus text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Inasistencias</p>
            <p class="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{{ inasistencias() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-calendar-times text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between col-span-2 sm:col-span-1">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Con motivo</p>
            <p class="text-xl sm:text-2xl font-bold text-white mt-1">{{ conMotivo() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400">
            <i class="pi pi-file-edit text-lg"></i>
          </div>
        </div>
      </div>

      <!-- Feedback -->
      @if (servicio.error()) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <i class="pi pi-exclamation-triangle"></i> {{ servicio.error() }}
        </div>
      }

      <!-- Carga -->
      @if (servicio.isLoading() && servicio.clientes().length === 0) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Listado -->
      @if (!servicio.isLoading() || servicio.clientes().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-xl">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/60">
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cliente</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Motivo</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Inasistencias</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Vinculado desde</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (fila of servicio.clientes(); track fila.clienteId) {
                  <tr class="hover:bg-white/5 transition-colors">
                    <td class="p-4">
                      <div class="font-bold text-white">{{ fila.nombreCompleto }}</div>
                      <div class="text-[11px] text-zinc-500">{{ fila.correo }}</div>
                      @if (fila.telefono) {
                        <div class="text-[11px] text-zinc-500 font-mono">{{ fila.telefono }}</div>
                      }
                    </td>
                    <td class="p-4">
                      @if (fila.motivoRestriccion) {
                        <p class="text-zinc-300 max-w-[260px]">{{ fila.motivoRestriccion }}</p>
                      } @else {
                        <p class="text-zinc-600 italic">Sin motivo registrado</p>
                      }
                    </td>
                    <td class="p-4">
                      <span
                        class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border"
                        [ngClass]="
                          fila.contadorNoPresentado >= 3
                            ? 'bg-rose-500/10 text-rose-300 border-rose-500/25'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                        "
                      >
                        {{ fila.contadorNoPresentado }}
                        {{ fila.contadorNoPresentado === 1 ? 'vez' : 'veces' }}
                      </span>
                    </td>
                    <td class="p-4 text-zinc-400">
                      {{ fila.vinculadoDesde ? (fila.vinculadoDesde | date: 'dd MMM yyyy') : '—' }}
                    </td>
                    <td class="p-4">
                      <div class="flex justify-end">
                        <button
                          (click)="reactivar(fila)"
                          [disabled]="procesandoId() !== null"
                          class="px-3.5 py-2 rounded-xl font-bold text-xs text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-1.5"
                        >
                          <i
                            class="pi"
                            [ngClass]="procesandoId() === fila.clienteId ? 'pi-spin pi-spinner' : 'pi-check'"
                          ></i>
                          Reactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (servicio.clientes().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-verified text-5xl text-emerald-500/60 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">Todos los clientes se encuentran habilitados.</p>
              <p class="text-xs text-zinc-500 mt-1">
                Una restricción aparece aquí cuando el contador de inasistencias alcanza el límite de
                la sede.
              </p>
            </div>
          }
        </div>
      }

      <p class="text-[11px] text-zinc-500 flex items-start gap-2">
        <i class="pi pi-info-circle mt-0.5 text-amber-400/70"></i>
        <span>
          Reactivar devuelve al cliente el derecho a agendar en esta sede y reinicia su contador.
          No modifica su cuenta en la plataforma.
        </span>
      </p>
    </div>
  `,
})
export class AdminClientesRestringidosComponent implements OnInit {
  protected readonly servicio = inject(ClientesRestringidosService);
  protected readonly barberiaActiva = inject(TenantService).barberiaActiva;

  private readonly tenant = inject(TenantService);
  private readonly toast = inject(ToastService);
  private readonly dialogo = inject(ConfirmDialogService);

  readonly procesandoId = signal<string | null>(null);

  readonly inasistencias = computed(() =>
    this.servicio
      .clientes()
      .reduce((total, fila) => total + (fila.contadorNoPresentado ?? 0), 0),
  );

  readonly conMotivo = computed(
    () => this.servicio.clientes().filter((fila) => !!fila.motivoRestriccion).length,
  );

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const barberiaId = this.tenant.barberiaActivaId();
    // El `tenantGuard` ya exige sede activa; sin ella no hay lista que pedir.
    if (!barberiaId) {
      return;
    }
    this.servicio.cargar(barberiaId).subscribe({ error: () => undefined });
  }

  async reactivar(fila: ClienteRestringido): Promise<void> {
    const barberiaId = this.tenant.barberiaActivaId();
    if (!barberiaId) {
      return;
    }

    const confirmado = await this.dialogo.confirm({
      titulo: 'Reactivar cliente',
      mensaje: `${fila.nombreCompleto} podrá volver a agendar en esta sede y su contador de inasistencias vuelve a cero.`,
      textoConfirmar: 'Reactivar',
      icono: 'pi pi-user-plus',
    });

    if (!confirmado) {
      return;
    }

    this.procesandoId.set(fila.clienteId);
    this.servicio.reactivar(barberiaId, fila.clienteId).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.toast.success(`${fila.nombreCompleto} ya puede agendar en esta sede.`, 'Restricción levantada');
      },
      error: (err) => {
        this.procesandoId.set(null);
        this.toast.error(this.mensajeDe(err), 'Clientes restringidos');
      },
    });
  }

  private mensajeDe(err: unknown): string {
    const cuerpo = (err as { error?: { mensaje?: string; message?: string } })?.error;
    return cuerpo?.mensaje || cuerpo?.message || 'No se pudo reactivar al cliente';
  }
}
