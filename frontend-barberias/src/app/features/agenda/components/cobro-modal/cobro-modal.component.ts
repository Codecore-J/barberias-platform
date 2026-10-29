import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ReservasService } from '../../../../core/services/reservas.service.js';
import { ModalOverlayDirective } from '../../../../shared/directives/modal-overlay.directive.js';

type MetodoCobro = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';

interface OpcionMetodo {
  valor: MetodoCobro;
  etiqueta: string;
  icono: string;
  detalle: string;
}

/**
 * V3 fase 6 · cobro de una cita desde la agenda.
 *
 * El total NO se escribe a mano: se muestra el `precioTotalHist` de la reserva y
 * se envía sin `monto`, para que el backend cobre exactamente ese total congelado
 * (`MONTO_NO_COINCIDE` si alguien intentara otra cifra). Pagos parciales no
 * existen en este flujo; el arqueo diario necesita un importe por cobro.
 *
 * El método es obligatorio y de catálogo cerrado: el cierre de caja agrupa por
 * EFECTIVO / TARJETA / TRANSFERENCIA, así que un valor libre dejaría dinero fuera
 * de las tres bolsas.
 */
@Component({
  selector: 'app-cobro-modal',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, ModalOverlayDirective],
  template: `
    <div
      appModalOverlay
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
      (click)="cerrar.emit()"
    >
      <div
        class="bg-zinc-900 border border-amber-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
        (click)="$event.stopPropagation()"
      >
        <div class="p-6 space-y-5">
          <!-- Cabecera -->
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400"
              >
                <i class="pi pi-wallet text-lg"></i>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">Cobrar cita</h3>
                <p class="text-xs text-zinc-400">Registra el pago y cierra la atención</p>
              </div>
            </div>
            <button
              type="button"
              (click)="cerrar.emit()"
              class="text-zinc-500 hover:text-white transition-colors"
              aria-label="Cerrar"
            >
              <i class="pi pi-times text-xl"></i>
            </button>
          </div>

          <!-- Resumen de la cita -->
          <div class="rounded-2xl bg-zinc-950/70 border border-white/5 p-4 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-400">Cliente</span>
              <span class="font-semibold text-white">{{ reserva().cliente?.nombre || 'Cliente' }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-400">Cita</span>
              <span class="font-medium text-zinc-200">
                {{ reserva().fechaHoraInicio | date: 'dd MMM · HH:mm' }}
              </span>
            </div>
            @if (reserva().barbero?.nombre) {
              <div class="flex items-center justify-between text-sm">
                <span class="text-zinc-400">Barbero</span>
                <span class="font-medium text-zinc-200">{{ reserva().barbero.nombre }}</span>
              </div>
            }
            @for (detalle of reserva().detalles || []; track $index) {
              <div class="flex items-center justify-between text-xs text-zinc-500">
                <span class="flex items-center gap-1.5">
                  <i class="pi pi-circle-fill text-[5px] text-amber-500/60"></i>
                  {{ detalle.nombreServicioHist }}
                </span>
                <span>{{ detalle.duracionMinutosHist }} min</span>
              </div>
            }
            <div class="flex items-center justify-between pt-2 border-t border-white/5">
              <span class="text-xs uppercase tracking-wider text-zinc-400 font-semibold">Total a pagar</span>
              <span class="text-2xl font-bold text-emerald-400">
                {{ total() | currency: 'USD' : 'symbol' : '1.2-2' }}
              </span>
            </div>
          </div>

          <!-- Método de pago -->
          <div class="space-y-2">
            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Método de pago</p>
            <div class="grid grid-cols-3 gap-2">
              @for (opcion of OPCIONES; track opcion.valor) {
                <button
                  type="button"
                  (click)="metodo.set(opcion.valor)"
                  [disabled]="procesando()"
                  [attr.aria-pressed]="metodo() === opcion.valor"
                  class="rounded-xl border px-3 py-3 text-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  [class.border-amber-500]="metodo() === opcion.valor"
                  [class.bg-amber-500/15]="metodo() === opcion.valor"
                  [class.text-amber-300]="metodo() === opcion.valor"
                  [class.border-white/10]="metodo() !== opcion.valor"
                  [class.bg-zinc-950/60]="metodo() !== opcion.valor"
                  [class.text-zinc-300]="metodo() !== opcion.valor"
                >
                  <i class="pi {{ opcion.icono }} block text-lg mb-1"></i>
                  <span class="text-xs font-semibold block">{{ opcion.etiqueta }}</span>
                  <span class="text-[10px] text-zinc-500 block">{{ opcion.detalle }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Cita que aún no empieza: el backend la rechaza (E3-09) -->
          @if (!citaIniciada()) {
            <div class="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 flex items-start gap-2">
              <i class="pi pi-clock mt-0.5"></i>
              <span>
                Esta cita todavía no ha comenzado. Podrás cobrarla a partir de su hora de inicio.
              </span>
            </div>
          }

          @if (error()) {
            <div class="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-start gap-2" role="alert">
              <i class="pi pi-exclamation-triangle mt-0.5"></i>
              <span>{{ error() }}</span>
            </div>
          }

          <!-- Acciones -->
          <div class="flex gap-3 pt-2 border-t border-zinc-800">
            <button
              type="button"
              (click)="cerrar.emit()"
              [disabled]="procesando()"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="confirmar()"
              [disabled]="procesando() || !citaIniciada()"
              class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <i class="pi" [ngClass]="procesando() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
              <span>{{ procesando() ? 'Cobrando...' : 'Confirmar cobro' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CobroModalComponent {
  private readonly reservasService = inject(ReservasService);

  readonly reserva = input.required<any>();
  readonly cobrado = output<any>();
  readonly cerrar = output<void>();

  readonly OPCIONES: OpcionMetodo[] = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo', icono: 'pi-money-bill', detalle: 'En caja' },
    { valor: 'TARJETA', etiqueta: 'Tarjeta', icono: 'pi-credit-card', detalle: 'Punto de venta' },
    { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', icono: 'pi-mobile', detalle: 'Banco' },
  ];

  readonly metodo = signal<MetodoCobro>('EFECTIVO');
  readonly procesando = signal(false);
  readonly error = signal<string | null>(null);

  readonly total = computed(() => Number(this.reserva()?.precioTotalHist) || 0);

  /**
   * La cita solo se cobra desde su hora de inicio (E3-09). Se compara contra el
   * reloj del navegador para avisar ANTES de enviar; el backend lo vuelve a
   * comprobar con el reloj del servidor y la zona de la sede.
   */
  readonly citaIniciada = computed(() => {
    const inicio = this.reserva()?.fechaHoraInicio;
    if (!inicio) return true;
    const instante = new Date(inicio).getTime();
    return Number.isNaN(instante) ? true : instante <= Date.now();
  });

  confirmar(): void {
    const reserva = this.reserva();
    if (!reserva?.id || this.procesando()) return;

    this.procesando.set(true);
    this.error.set(null);

    // Sin `monto`: el backend cobra el total congelado de la reserva.
    this.reservasService.registrarCobro(reserva.id, this.metodo()).subscribe({
      next: (resultado) => {
        this.procesando.set(false);
        this.cobrado.emit(resultado);
      },
      error: (err) => {
        this.procesando.set(false);
        this.error.set(this.mensajeDeError(err));
      },
    });
  }

  private mensajeDeError(err: any): string {
    const backend = err?.error?.mensaje || err?.error?.message;
    if (typeof backend === 'string' && backend.trim()) return backend;

    switch (err?.status) {
      case 409:
        return 'Esta cita ya fue cobrada. Refresca la agenda para ver su estado actual.';
      case 422:
        return 'La cita todavía no puede cobrarse o el monto no coincide con su total.';
      case 403:
        return 'No tienes permiso para cobrar esta cita.';
      case 404:
        return 'La reserva ya no existe. Refresca la agenda.';
      default:
        return 'No se pudo registrar el cobro. Intenta de nuevo.';
    }
  }
}
