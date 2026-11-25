import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  AntecedenteDeCliente,
  AntecedentesService,
  ClienteElegible,
  SolicitudAntecedente,
} from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · el barbero reporta un incidente.
 *
 * Solo ve sus propias solicitudes y los antecedentes de clientes que pasaron
 * por su agenda (C-5, aplicado en el backend). Si llega desde la ficha de un
 * cliente, `?clienteId=` deja el selector prellenado.
 */
@Component({
  selector: 'app-barbero-antecedentes',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-4xl mx-auto space-y-8 bg-ambient-mesh">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-20">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-flag text-xs"></i>
            <span>Mi agenda · antecedentes</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">Reportar <span class="text-amber-400">incidente</span></h2>
          <p class="text-sm text-zinc-400">La plataforma revisa el reporte antes de publicarlo. Solo ves tus solicitudes y los antecedentes de tus clientes.</p>
        </div>
        <div class="flex gap-2">
          <button (click)="cargar()"
                  class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-2">
            <i class="pi pi-refresh" [ngClass]="cargando() ? 'pi-spin' : ''"></i> Actualizar
          </button>
          <button (click)="formularioAbierto.set(!formularioAbierto())"
                  class="px-4 py-2 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 transition-all flex items-center gap-2">
            <i class="pi pi-flag"></i> Reportar incidente
          </button>
        </div>
      </div>

      @if (formularioAbierto()) {
      <div class="glass-panel p-6 rounded-3xl border border-amber-500/30 relative z-10 space-y-4">
        <h3 class="text-lg font-bold text-white">Nueva solicitud</h3>

        <label class="space-y-1.5 block">
          <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cliente</span>
          <select id="barbero-cliente" [(ngModel)]="clienteId" (ngModelChange)="cargarAntecedentes($event)"
                  class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white">
            <option value="">Elige un cliente de tu agenda…</option>
            @for (cliente of clientes(); track cliente.id) {
              <option [value]="cliente.id">{{ cliente.nombreCompleto }} · {{ cliente.correo }}</option>
            }
          </select>
        </label>

        <label class="space-y-1.5 block">
          <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Motivo</span>
          <textarea id="barbero-motivo" [(ngModel)]="motivo" rows="3" maxlength="2000"
                    placeholder="Qué ocurrió durante o alrededor del servicio"
                    class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white"></textarea>
        </label>

        <label class="space-y-1.5 block">
          <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Evidencia (opcional)</span>
          <textarea id="barbero-evidencia" [(ngModel)]="evidenciaTexto" rows="2" maxlength="2000"
                    class="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white"></textarea>
        </label>

        @if (error()) {
          <p class="text-xs text-rose-400">{{ error() }}</p>
        }

        <div class="flex justify-end">
          <button id="barbero-enviar" (click)="enviar()" [disabled]="enviando()"
                  class="px-5 py-2 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
            <i class="pi" [ngClass]="enviando() ? 'pi-spin pi-spinner' : 'pi-send'"></i> Enviar reporte
          </button>
        </div>
      </div>
      }

      @if (clienteId && antecedentesCliente().length > 0) {
        <div class="glass-panel p-5 rounded-2xl border border-white/5 relative z-10 space-y-3">
          <h3 class="text-sm font-bold text-amber-400 uppercase tracking-widest">Antecedentes del cliente</h3>
          @for (antecedente of antecedentesCliente(); track antecedente.id) {
            <div class="text-sm text-zinc-300 bg-black/30 rounded-xl p-3 border border-white/5">
              <span class="text-[10px] uppercase text-zinc-500">{{ antecedente.estadoValidacion }} · {{ antecedente.creadoAt | date:'mediumDate' }}</span>
              <p>{{ antecedente.contenido }}</p>
            </div>
          }
        </div>
      }

      <div class="space-y-3 relative z-10">
        <h3 class="text-sm font-bold text-amber-400 uppercase tracking-widest">Mis solicitudes</h3>

        @if (cargando()) {
          <div class="flex justify-center py-10">
            <i class="pi pi-spin pi-spinner text-3xl text-amber-500"></i>
          </div>
        } @else if (solicitudes().length === 0) {
          <p class="text-sm text-zinc-500">Todavía no reportaste ningún incidente.</p>
        } @else {
          @for (solicitud of solicitudes(); track solicitud.id) {
            <div class="glass-panel p-5 rounded-2xl border border-white/5 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-lg border"
                      [ngClass]="claseEstado(solicitud.estado)">
                  {{ solicitud.estado }}
                </span>
                <span class="text-xs text-zinc-400">{{ solicitud.cliente?.nombreCompleto || 'Cliente' }}</span>
                <span class="text-xs text-zinc-500">{{ solicitud.creadoAt | date:'medium' }}</span>
              </div>
              <p class="text-sm text-zinc-300">{{ solicitud.motivo }}</p>
              @if (solicitud.estado === 'DENEGADA' && solicitud.motivoDenegacion) {
                <p class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                  <strong>Motivo de la denegación:</strong> {{ solicitud.motivoDenegacion }}
                </p>
              }
            </div>
          }
        }
      </div>
    </div>
  `
})
export class BarberoAntecedentesComponent implements OnInit {
  private readonly antecedentes = inject(AntecedentesService);
  private readonly tenant = inject(TenantService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  readonly solicitudes = signal<SolicitudAntecedente[]>([]);
  readonly clientes = signal<ClienteElegible[]>([]);
  readonly antecedentesCliente = signal<AntecedenteDeCliente[]>([]);
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly formularioAbierto = signal(false);
  readonly error = signal<string | null>(null);

  clienteId = '';
  motivo = '';
  evidenciaTexto = '';

  ngOnInit(): void {
    const prellenado = this.route.snapshot.queryParamMap.get('clienteId');
    if (prellenado) {
      this.clienteId = prellenado;
    }

    this.cargar();
    if (this.clienteId) {
      this.cargarAntecedentes(this.clienteId);
    }
  }

  cargar(): void {
    const barberiaId = this.tenant.barberiaActivaId();
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

  cargarAntecedentes(clienteId: string): void {
    const barberiaId = this.tenant.barberiaActivaId();
    if (!barberiaId || !clienteId) {
      this.antecedentesCliente.set([]);
      return;
    }

    this.antecedentes.obtenerAntecedentesDeCliente(barberiaId, clienteId).subscribe({
      next: (data) => this.antecedentesCliente.set(data || []),
      error: () => this.antecedentesCliente.set([]),
    });
  }

  enviar(): void {
    const barberiaId = this.tenant.barberiaActivaId();
    if (!barberiaId) return;

    if (!this.clienteId) {
      this.error.set('Elige el cliente del incidente.');
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
        this.motivo = '';
        this.evidenciaTexto = '';
        this.toast.success('Reporte enviado a la plataforma.', 'Enviado');
        this.cargar();
      },
      error: (err) => {
        this.enviando.set(false);
        this.error.set(err?.error?.mensaje || 'No se pudo enviar el reporte.');
      },
    });
  }

  claseEstado(estado: string): string {
    if (estado === 'APROBADA') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    if (estado === 'DENEGADA') return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }
}
