import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import {
  AntecedentesService,
  SolicitudAntecedente,
} from '../../../core/services/antecedentes.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * F5 / T-55 · bandeja de la plataforma.
 *
 * Solo el ADMINISTRADOR global decide. Denegar exige motivo; aprobar crea el
 * antecedente en el backend. La fila resuelta desaparece de PENDIENTES.
 */
@Component({
  selector: 'app-admin-solicitudes-antecedentes',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-20">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <i class="pi pi-shield text-xs"></i>
            <span>Plataforma · seguridad</span>
          </div>
          <h2 class="text-3xl font-display font-bold text-white">Solicitudes de <span class="text-amber-400">antecedentes</span></h2>
          <p class="text-sm text-zinc-400">Pendientes de todas las sedes. Aprobar publica el antecedente; denegar exige motivo.</p>
        </div>
        <button (click)="cargar()"
                class="px-4 py-2 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all flex items-center gap-2">
          <i class="pi pi-refresh" [ngClass]="cargando() ? 'pi-spin' : ''"></i> Actualizar
        </button>
      </div>

      @if (cargando()) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      } @else if (solicitudes().length === 0) {
        <div class="glass-panel p-12 text-center rounded-3xl border border-white/5 relative z-10 space-y-3">
          <div class="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-4xl text-emerald-400">
            <i class="pi pi-check-circle"></i>
          </div>
          <h3 class="text-xl font-bold text-white">Sin solicitudes pendientes</h3>
          <p class="text-zinc-400 text-sm">Ninguna sede ha pedido un antecedente por revisar.</p>
        </div>
      } @else {
        <div class="space-y-4 relative z-10">
          <p class="text-xs text-zinc-400">
            Mostrando <span class="text-amber-400 font-bold">{{ solicitudes().length }}</span> solicitud(es) pendiente(s).
          </p>

          @for (solicitud of solicitudes(); track solicitud.id) {
            <div class="glass-panel p-6 rounded-3xl border border-amber-500/30 shadow-xl flex flex-col md:flex-row gap-6 justify-between items-start">
              <div class="space-y-3 flex-1">
                <div class="flex flex-wrap items-center gap-2.5">
                  <span class="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-amber-500/30 text-amber-400 bg-amber-500/10">
                    PENDIENTE
                  </span>
                  <span class="text-xs text-zinc-400">
                    <i class="pi pi-building mr-1 text-[11px]"></i>{{ solicitud.barberia?.nombre || 'Sede' }}
                  </span>
                  <span class="text-xs text-zinc-500">{{ solicitud.creadoAt | date:'medium' }}</span>
                </div>

                <div>
                  <h4 class="text-lg font-bold text-white">
                    Cliente: <span class="text-amber-400">{{ solicitud.cliente?.nombreCompleto || 'Desconocido' }}</span>
                  </h4>
                  <p class="text-xs text-zinc-400 mt-0.5">
                    Solicitado por <strong class="text-zinc-300">{{ solicitud.solicitante?.nombreCompleto || 'personal de la sede' }}</strong>
                  </p>
                </div>

                <p class="text-sm text-zinc-300 bg-black/40 p-3.5 rounded-2xl border border-white/5 leading-relaxed">
                  "{{ solicitud.motivo }}"
                </p>

                @if (solicitud.evidenciaTexto) {
                  <p class="text-xs text-zinc-400 bg-black/20 p-3 rounded-xl border border-white/5">
                    <strong class="text-zinc-300">Evidencia:</strong> {{ solicitud.evidenciaTexto }}
                  </p>
                }
              </div>

              <div class="flex flex-col gap-2.5 w-full md:w-44 shrink-0">
                <button (click)="aprobar(solicitud)" [disabled]="procesando() === solicitud.id"
                        class="w-full px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all">
                  <i class="pi" [ngClass]="procesando() === solicitud.id ? 'pi-spin pi-spinner' : 'pi-check'"></i> Aprobar
                </button>
                <button (click)="denegar(solicitud)" [disabled]="procesando() === solicitud.id"
                        class="w-full px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-all">
                  <i class="pi pi-times"></i> Denegar
                </button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class AdminSolicitudesAntecedentesComponent implements OnInit {
  private readonly antecedentes = inject(AntecedentesService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  readonly solicitudes = signal<SolicitudAntecedente[]>([]);
  readonly cargando = signal(true);
  readonly procesando = signal<string | null>(null);

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.antecedentes.listarSolicitudesPendientesGlobal().subscribe({
      next: (data) => {
        this.solicitudes.set(data || []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  async aprobar(solicitud: SolicitudAntecedente): Promise<void> {
    const confirmado = await this.confirmDialog.confirm({
      titulo: 'Aprobar antecedente',
      mensaje: `El antecedente de ${solicitud.cliente?.nombreCompleto || 'este cliente'} quedará publicado en su ficha.`,
      textoConfirmar: 'Sí, aprobar',
      icono: 'pi pi-check-circle',
    });
    if (!confirmado) return;

    this.procesando.set(solicitud.id);
    this.antecedentes.resolverSolicitud(solicitud.id, 'APROBAR').subscribe({
      next: () => {
        this.procesando.set(null);
        this.toast.success('Antecedente aprobado y publicado.', 'Aprobado');
        this.cargar();
      },
      error: () => this.procesando.set(null),
    });
  }

  async denegar(solicitud: SolicitudAntecedente): Promise<void> {
    const motivo = await this.confirmDialog.solicitarTexto({
      titulo: 'Denegar solicitud',
      mensaje: `Indica por qué se deniega el antecedente de ${solicitud.cliente?.nombreCompleto || 'este cliente'}.`,
      textoConfirmar: 'Denegar',
      tono: 'peligro',
      icono: 'pi pi-times-circle',
      entrada: {
        etiqueta: 'Motivo de la denegación',
        marcador: 'Ej.: el reporte no describe un hecho verificable',
        multilinea: true,
        obligatorio: true,
        mensajeObligatorio: 'El motivo es obligatorio para denegar.',
      },
    });
    if (motivo === null) return;

    this.procesando.set(solicitud.id);
    this.antecedentes.resolverSolicitud(solicitud.id, 'DENEGAR', motivo).subscribe({
      next: () => {
        this.procesando.set(null);
        this.toast.warning('Solicitud denegada. La sede verá el motivo.', 'Denegada');
        this.cargar();
      },
      error: () => this.procesando.set(null),
    });
  }
}
