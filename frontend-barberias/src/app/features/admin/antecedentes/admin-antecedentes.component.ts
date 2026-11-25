import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AntecedentesService,
  ClienteElegible,
  SolicitudAntecedente,
} from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · la sede pide, no decide.
 *
 * El ADMIN_BARBERIA elige un cliente que ya pasó por la sede, escribe el motivo
 * (y evidencia opcional) y sigue el estado de lo pedido. La aprobación vive en
 * la bandeja de la plataforma.
 */
@Component({
  selector: 'app-admin-antecedentes',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-20">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-shield text-xs"></i>
            <span>Antecedentes · solicitud</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">Antecedentes de <span class="text-amber-400">{{ tenantService.nombreBarberiaActiva() }}</span></h2>
          <p class="text-sm text-zinc-400">Pide la revisión de un antecedente. La plataforma decide; aquí ves el estado y el motivo de una denegación.</p>
        </div>

        <div class="flex gap-2">
          <button (click)="cargar()"
                  class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-2">
            <i class="pi pi-refresh" [ngClass]="cargando() ? 'pi-spin' : ''"></i> Actualizar
          </button>
          <button (click)="formularioAbierto.set(!formularioAbierto())"
                  class="px-4 py-2 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 transition-all flex items-center gap-2">
            <i class="pi pi-plus"></i> Solicitar antecedente
          </button>
        </div>
      </div>

      @if (formularioAbierto()) {
        <div class="glass-panel p-6 rounded-3xl border border-amber-500/30 relative z-10 space-y-4">
          <h3 class="text-lg font-bold text-white">Nueva solicitud</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label class="space-y-1.5 block">
              <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cliente</span>
              <select id="solicitud-cliente" [(ngModel)]="clienteId"
                      class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white">
                <option value="">Elige un cliente…</option>
                @for (cliente of clientes(); track cliente.id) {
                  <option [value]="cliente.id">{{ cliente.nombreCompleto }} · {{ cliente.correo }}</option>
                }
              </select>
              @if (clientes().length === 0) {
                <span class="text-[11px] text-zinc-500">Solo aparecen clientes con una cita ya ocurrida en la sede.</span>
              }
            </label>

            <label class="space-y-1.5 block">
              <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Motivo</span>
              <textarea id="solicitud-motivo" [(ngModel)]="motivo" rows="3" maxlength="2000"
                        placeholder="Qué ocurrió y por qué debe revisarse"
                        class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white"></textarea>
            </label>
          </div>

          <label class="space-y-1.5 block">
            <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Evidencia (opcional)</span>
            <textarea id="solicitud-evidencia" [(ngModel)]="evidenciaTexto" rows="2" maxlength="2000"
                      placeholder="Testigos, notas de recepción, etc."
                      class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white"></textarea>
          </label>

          @if (error()) {
            <p class="text-xs text-rose-400">{{ error() }}</p>
          }

          <div class="flex justify-end gap-2">
            <button (click)="formularioAbierto.set(false)"
                    class="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 border border-zinc-700">
              Cancelar
            </button>
            <button id="enviar-solicitud" (click)="enviar()" [disabled]="enviando()"
                    class="px-5 py-2 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
              <i class="pi" [ngClass]="enviando() ? 'pi-spin pi-spinner' : 'pi-send'"></i> Enviar solicitud
            </button>
          </div>
        </div>
      }

      @if (cargando()) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      } @else if (solicitudes().length === 0) {
        <div class="glass-panel p-12 text-center rounded-3xl border border-white/5 relative z-10 space-y-2">
          <h3 class="text-xl font-bold text-white">Todavía no hay solicitudes</h3>
          <p class="text-zinc-400 text-sm">Cuando pidas un antecedente, su estado aparecerá aquí.</p>
        </div>
      } @else {
        <div class="space-y-3 relative z-10">
          @for (solicitud of solicitudes(); track solicitud.id) {
            <div class="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
              <div class="space-y-1.5 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-lg border"
                        [ngClass]="claseEstado(solicitud.estado)">
                    {{ solicitud.estado }}
                  </span>
                  <span class="text-xs text-zinc-400">{{ solicitud.cliente?.nombreCompleto || 'Cliente' }}</span>
                  <span class="text-xs text-zinc-500">{{ solicitud.creadoAt | date:'medium' }}</span>
                </div>
                <p class="text-sm text-zinc-300">{{ solicitud.motivo }}</p>
                @if (solicitud.evidenciaTexto) {
                  <p class="text-xs text-zinc-500">Evidencia: {{ solicitud.evidenciaTexto }}</p>
                }
                @if (solicitud.estado === 'DENEGADA' && solicitud.motivoDenegacion) {
                  <p class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                    <strong>Motivo de la denegación:</strong> {{ solicitud.motivoDenegacion }}
                  </p>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class AdminAntecedentesComponent implements OnInit {
  private readonly antecedentes = inject(AntecedentesService);
  protected readonly tenantService = inject(TenantService);
  private readonly toast = inject(ToastService);

  readonly solicitudes = signal<SolicitudAntecedente[]>([]);
  readonly clientes = signal<ClienteElegible[]>([]);
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly formularioAbierto = signal(false);
  readonly error = signal<string | null>(null);

  clienteId = '';
  motivo = '';
  evidenciaTexto = '';

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const barberiaId = this.tenantService.barberiaActivaId();
    if (!barberiaId) return;

    this.cargando.set(true);
    this.antecedentes.listarSolicitudes(barberiaId).subscribe({
      next: (data) => {
        this.solicitudes.set(data || []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });

    this.antecedentes.listarClientesElegibles(barberiaId).subscribe({
      next: (data) => this.clientes.set(data || []),
      error: () => this.clientes.set([]),
    });
  }

  enviar(): void {
    const barberiaId = this.tenantService.barberiaActivaId();
    if (!barberiaId) return;

    if (!this.clienteId) {
      this.error.set('Elige el cliente sobre el que se pide el antecedente.');
      return;
    }
    if (!this.motivo.trim()) {
      this.error.set('El motivo es obligatorio.');
      return;
    }

    this.error.set(null);
    this.enviando.set(true);

    this.antecedentes.crearSolicitud(barberiaId, {
      clienteId: this.clienteId,
      motivo: this.motivo.trim(),
      evidenciaTexto: this.evidenciaTexto.trim() || undefined,
    }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.formularioAbierto.set(false);
        this.clienteId = '';
        this.motivo = '';
        this.evidenciaTexto = '';
        this.toast.success('Solicitud enviada a la plataforma.', 'Enviada');
        this.cargar();
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.error?.mensaje || 'No se pudo enviar la solicitud.');
      },
    });
  }

  claseEstado(estado: string): string {
    if (estado === 'APROBADA') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (estado === 'DENEGADA') return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }
}
