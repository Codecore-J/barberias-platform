import { Component, EventEmitter, Input, Output, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReservasService } from '../../../../core/services/reservas.service';
import { Personal } from '../../../../core/services/personal.service';
import { ServiciosService } from '../../../../core/services/servicios.service';
import { TenantService } from '../../../../core/services/tenant.service';

@Component({
  selector: 'app-walk-in-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" (click)="close.emit()"></div>
      
      <div class="glass-panel w-full max-w-lg rounded-3xl border border-white/10 p-6 relative z-10 animate-fade-in transform-style-3d shadow-2xl">
        <button (click)="close.emit()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
          <i class="pi pi-times"></i>
        </button>

        <h3 class="text-2xl font-display font-bold text-white mb-2">Ingreso <span class="gold-gradient-text">Walk-In</span></h3>
        <p class="text-zinc-400 text-sm mb-6">Agendar turno manual para cliente sin app.</p>

        <form (submit)="onSubmit($event)" class="space-y-4">
          
          <div class="grid grid-cols-2 gap-4">
            <!-- Hora Inicio -->
            <div>
              <label class="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Hora (HH:mm)</label>
              <input type="time" [(ngModel)]="horaInicio" name="horaInicio" required
                     class="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all">
            </div>

            <!-- Barbero -->
            <div>
              <label class="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Barbero</label>
              <select [(ngModel)]="barberoId" name="barberoId" required
                      class="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all appearance-none">
                <option value="" disabled selected>Selecciona...</option>
                @for (b of barberos; track b.id) {
                  <option [value]="b.id">{{ b.nombreCompleto }}</option>
                }
              </select>
            </div>
          </div>

          <!-- Nombre Invitado -->
          <div>
            <label class="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Nombre del Cliente (Opcional)</label>
            <input type="text" [(ngModel)]="nombreInvitado" name="nombreInvitado" placeholder="Ej. Juan Pérez (Invitado)"
                   class="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:border-amber-500 transition-all">
          </div>

          <!-- Servicio -->
          <div>
            <label class="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Servicio</label>
            <select [(ngModel)]="servicioId" name="servicioId" required
                    class="w-full bg-zinc-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all appearance-none">
              <option value="" disabled selected>Selecciona un servicio...</option>
              @for (s of servicios(); track s.id) {
                <option [value]="s.id">{{ s.nombre }} - \${{ s.precio }} ({{ s.duracionEstimada }}m)</option>
              }
            </select>
          </div>

          @if (errorMsg()) {
            <div class="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
              {{ errorMsg() }}
            </div>
          }

          <div class="pt-4">
            <button type="submit" [disabled]="guardando() || !horaInicio || !barberoId || !servicioId"
                    class="w-full py-3.5 rounded-xl font-bold text-zinc-950 gold-gradient-bg shadow-[0_5px_20px_rgba(212,175,55,0.3)] hover:shadow-[0_10px_30px_rgba(212,175,55,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              <i class="pi" [ngClass]="guardando() ? 'pi-spin pi-spinner' : 'pi-calendar-plus'"></i>
              <span class="ml-2">{{ guardando() ? 'Creando...' : 'Crear Turno Walk-In' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `
})
export class WalkInModalComponent implements OnInit {
  @Input() fecha!: string; // YYYY-MM-DD
  @Input() barberos: Personal[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() creado = new EventEmitter<void>();

  private tenantService = inject(TenantService);
  private serviciosService = inject(ServiciosService);
  private reservasService = inject(ReservasService);

  servicios = signal<any[]>([]);
  
  horaInicio: string = '';
  barberoId: string = '';
  nombreInvitado: string = '';
  servicioId: string = '';

  guardando = signal(false);
  errorMsg = signal('');

  ngOnInit() {
    this.cargarServicios();
  }

  cargarServicios() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;
    this.serviciosService.cargarServicios().subscribe(data => {
      this.servicios.set(data);
    });
  }

  calcularHoraFin(horaIni: string, duracionMin: number): string {
    const [h, m] = horaIni.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + duracionMin);
    return date.toTimeString().substring(0, 5);
  }

  onSubmit(e: Event) {
    e.preventDefault();
    if (!this.horaInicio || !this.barberoId || !this.servicioId) return;

    this.guardando.set(true);
    this.errorMsg.set('');

    const servicioSelected = this.servicios().find(s => s.id === this.servicioId);
    if (!servicioSelected) {
      this.errorMsg.set('Servicio inválido');
      this.guardando.set(false);
      return;
    }

    const horaFinCalculada = this.calcularHoraFin(this.horaInicio, servicioSelected.duracionEstimada);

    const payload = {
      fecha: this.fecha,
      horaInicio: this.horaInicio,
      horaFin: horaFinCalculada,
      serviciosIds: [this.servicioId],
      precioTotalEsperado: Number(servicioSelected.precio),
      barberoId: this.barberoId,
      nombreInvitado: this.nombreInvitado || 'Cliente Walk-In'
    };

    // E3-03: el walk-in ya no comparte la ruta con el wizard del cliente.
    this.reservasService.crearReservaWalkIn(payload).subscribe({
      next: () => {
        this.guardando.set(false);
        this.creado.emit();
      },
      error: (err) => {
        this.guardando.set(false);
        this.errorMsg.set(err.error?.message || 'Error al crear la cita');
      }
    });
  }
}
