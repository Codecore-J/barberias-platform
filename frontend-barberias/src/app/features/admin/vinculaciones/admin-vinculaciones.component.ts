import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  VinculacionPendiente,
  VinculacionesService,
} from '../../../core/services/vinculaciones.service';

/** El backend exige un motivo con contenido (422 `MOTIVO_REQUERIDO`). */
const MOTIVO_MINIMO = 10;

/**
 * E3-12 · bandeja de aprobación de la 6.ª vinculación (D10).
 *
 * Décima vinculación de un cliente = decisión de PLATAFORMA: el límite se
 * cuenta por usuario, no por sede, así que la ruta es exclusiva del
 * `ADMINISTRADOR` (el `RolesGuard` del backend deniega al resto por
 * fail-closed) y aquí se cablean sus tres endpoints.
 *
 * La pantalla no decide nada por su cuenta: pinta lo que devuelve la bandeja y
 * deja que el backend responda con el contrato de errores D40, cuyo `mensaje`
 * se muestra tal cual (`VinculacionesService.error`).
 */
@Component({
  selector: 'app-admin-vinculaciones',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-6xl mx-auto space-y-8 bg-ambient-mesh">
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-shield text-xs"></i>
            <span>Decisión de plataforma</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">
            Vinculaciones <span class="gold-gradient-text">pendientes</span>
          </h2>
          <p class="text-sm text-zinc-400">
            Clientes que agotaron sus 5 barberías y esperan aprobación para entrar en una sexta
          </p>
        </div>

        <button (click)="cargar()"
                class="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-zinc-950 gold-gradient-bg shadow-[0_4px_16px_rgba(212,175,55,0.25)] hover:brightness-110 transition-all flex items-center gap-2">
          <i class="pi pi-refresh" [class.pi-spin]="service.isLoading()"></i> Refrescar
        </button>
      </div>

      <!-- Métricas -->
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">En espera</p>
            <p class="text-xl sm:text-2xl font-bold text-amber-400 mt-1">{{ service.total() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <i class="pi pi-hourglass text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Sedes implicadas</p>
            <p class="text-xl sm:text-2xl font-bold text-white mt-1">{{ sedesImplicadas() }}</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400">
            <i class="pi pi-building text-lg"></i>
          </div>
        </div>

        <div class="glass-panel p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div>
            <p class="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Límite de D10</p>
            <p class="text-xl sm:text-2xl font-bold text-zinc-300 mt-1">5</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400">
            <i class="pi pi-shield text-lg"></i>
          </div>
        </div>
      </div>

      <!-- Feedback -->
      @if (mensajeExito()) {
        <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
        </div>
      }

      @if (service.error()) {
        <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <i class="pi pi-exclamation-triangle"></i> {{ service.error() }}
        </div>
      }

      <!-- Estado de carga -->
      @if (service.isLoading() && service.pendientes().length === 0) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Tabla -->
      @if (!service.isLoading() || service.pendientes().length > 0) {
        <div class="glass-panel rounded-3xl overflow-hidden border border-white/10 shadow-xl">
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-white/5 bg-zinc-900/60">
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Cliente</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Sede solicitada</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Barberías</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest whitespace-nowrap">Solicitada</th>
                  <th class="p-4 font-bold text-amber-400 uppercase tracking-widest text-right whitespace-nowrap">Resolución</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                @for (fila of service.pendientes(); track fila.vinculacionId) {
                  <tr class="hover:bg-white/5 transition-colors group">
                    <td class="p-4">
                      <div class="font-bold text-white">{{ fila.nombreCompleto }}</div>
                      <div class="text-[11px] text-zinc-500">{{ fila.correo }}</div>
                      @if (fila.telefono) {
                        <div class="text-[11px] text-zinc-500 font-mono">{{ fila.telefono }}</div>
                      }
                    </td>
                    <td class="p-4">
                      <div class="text-zinc-200 font-medium">{{ fila.barberiaNombre }}</div>
                      <div class="text-[11px] text-zinc-500 font-mono">{{ fila.barberiaId }}</div>
                    </td>
                    <td class="p-4">
                      <span class="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25 inline-flex items-center gap-1.5">
                        <i class="pi pi-building"></i> {{ fila.vinculacionesDelCliente }} en total
                      </span>
                    </td>
                    <td class="p-4 text-zinc-400">
                      {{ fila.solicitadaAt ? (fila.solicitadaAt | date:'dd MMM yyyy · HH:mm') : '—' }}
                    </td>
                    <td class="p-4">
                      <div class="flex items-center justify-end gap-2">
                        <button (click)="aprobar(fila)" [disabled]="procesandoId() !== null"
                                class="px-3.5 py-2 rounded-xl font-bold text-xs text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 transition-all flex items-center gap-1.5">
                          <i class="pi" [ngClass]="procesandoId() === fila.vinculacionId ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                          Aprobar
                        </button>
                        <button (click)="abrirRechazo(fila)" [disabled]="procesandoId() !== null"
                                class="px-3.5 py-2 rounded-xl font-semibold text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-40 transition-all flex items-center gap-1.5">
                          <i class="pi pi-times"></i> Rechazar
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (service.pendientes().length === 0) {
            <div class="text-center py-20">
              <i class="pi pi-check-circle text-5xl text-emerald-500/60 mb-4 block"></i>
              <p class="text-zinc-300 font-medium">No hay vinculaciones esperando aprobación.</p>
              <p class="text-xs text-zinc-500 mt-1">
                La 6.ª barbería de un cliente aparece aquí en cuanto introduce un código de acceso.
              </p>
            </div>
          }
        </div>
      }

      <!-- Modal de rechazo: el motivo es obligatorio en el diseño -->
      @if (seleccionada(); as fila) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div class="bg-zinc-900 border border-rose-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-5">
              <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <i class="pi pi-times-circle text-lg"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold text-white">Rechazar vinculación</h3>
                    <p class="text-xs text-zinc-400">{{ fila.nombreCompleto }} · {{ fila.barberiaNombre }}</p>
                  </div>
                </div>
                <button (click)="cerrarModal()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                El vínculo quedará <span class="font-semibold">DESVINCULADO</span> y el cliente recibirá
                el motivo. El motivo es obligatorio y queda auditado.
              </div>

              <div>
                <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Motivo del rechazo</label>
                <textarea [(ngModel)]="motivo" rows="3" maxlength="500"
                          class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors"
                          placeholder="Explica por qué no se concede la sexta barbería"></textarea>
                <p class="text-[11px] mt-1.5"
                   [ngClass]="motivoValido() ? 'text-zinc-500' : 'text-rose-400'">
                  {{ motivo().trim().length }}/{{ MOTIVO_MINIMO }} caracteres mínimos
                </p>
              </div>

              <div class="flex gap-3 pt-2 border-t border-zinc-800">
                <button (click)="cerrarModal()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="confirmarRechazo()" [disabled]="!motivoValido() || procesandoId() !== null"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <i class="pi" [ngClass]="procesandoId() !== null ? 'pi-spin pi-spinner' : 'pi-ban'"></i>
                  <span>Confirmar rechazo</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AdminVinculacionesComponent implements OnInit {
  protected readonly service = inject(VinculacionesService);
  protected readonly MOTIVO_MINIMO = MOTIVO_MINIMO;

  readonly procesandoId = signal<string | null>(null);
  readonly seleccionada = signal<VinculacionPendiente | null>(null);
  readonly motivo = signal('');
  readonly mensajeExito = signal('');

  readonly motivoValido = computed(() => this.motivo().trim().length >= MOTIVO_MINIMO);

  /** Una sede puede llevar varias solicitudes: la métrica las agrupa. */
  readonly sedesImplicadas = computed(
    () => new Set(this.service.pendientes().map((fila) => fila.barberiaId)).size,
  );

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.service.cargarPendientes().subscribe({ error: () => undefined });
  }

  aprobar(fila: VinculacionPendiente): void {
    this.procesandoId.set(fila.vinculacionId);
    this.service.aprobar(fila.vinculacionId).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.avisar(`Vinculación aprobada: ${fila.nombreCompleto} ya opera en ${fila.barberiaNombre}.`);
      },
      error: () => this.procesandoId.set(null),
    });
  }

  abrirRechazo(fila: VinculacionPendiente): void {
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

    this.procesandoId.set(fila.vinculacionId);
    this.service.rechazar(fila.vinculacionId, this.motivo().trim()).subscribe({
      next: () => {
        this.procesandoId.set(null);
        this.cerrarModal();
        this.avisar(`Vinculación rechazada: ${fila.nombreCompleto} no entra en ${fila.barberiaNombre}.`);
      },
      error: () => this.procesandoId.set(null),
    });
  }

  private avisar(texto: string): void {
    this.mensajeExito.set(texto);
    setTimeout(() => this.mensajeExito.set(''), 5000);
  }
}
