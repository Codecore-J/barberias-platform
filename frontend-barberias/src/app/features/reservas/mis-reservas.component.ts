import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReservasService } from '../../core/services/reservas.service';

@Component({
  selector: 'app-mis-reservas',
  standalone: true,
  imports: [CommonModule, RouterLink, CurrencyPipe, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-4xl mx-auto space-y-12 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Header -->
      <section class="text-center space-y-4 transform translate-z-12">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(212,175,55,0.2)]">
          <i class="pi pi-calendar"></i>
          <span>Tu Agenda Personal</span>
        </div>
        <h2 class="text-4xl sm:text-5xl font-display font-extrabold text-white drop-shadow-2xl">
          Mis <span class="gold-gradient-text">Citas</span>
        </h2>
      </section>

      @if (reservasService.isLoading()) {
        <div class="flex justify-center items-center py-20 transform translate-z-12">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      @if (!reservasService.isLoading() && reservas().length === 0) {
        <div class="glass-panel max-w-md mx-auto text-center p-10 rounded-3xl border border-amber-500/20 transform translate-z-12">
          <i class="pi pi-calendar-times text-6xl text-zinc-600 mb-6"></i>
          <h3 class="text-xl font-bold text-white mb-2">No tienes citas agendadas</h3>
          <p class="text-zinc-400 text-sm mb-8">Parece que es hora de un buen corte. ¿Agendamos?</p>
          <a routerLink="/reservas/nueva" class="px-8 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform inline-flex items-center gap-2">
            <i class="pi pi-calendar-plus"></i> Reservar Ahora
          </a>
        </div>
      }

      @if (!reservasService.isLoading() && reservas().length > 0) {
        <!-- Timeline 3D -->
        <div class="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-amber-500/50 before:to-transparent">
          
          @for (reserva of reservas(); track reserva.id) {
            <div class="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active transform-style-3d hover:-translate-y-2 transition-transform duration-500">
              
              <!-- Icono del Timeline -->
              <div class="flex items-center justify-center w-10 h-10 rounded-full border-4 border-obsidian shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_15px_rgba(212,175,55,0.4)] z-10 transform translate-z-24"
                   [ngClass]="{
                     'bg-amber-500': reserva.estado === 'PENDIENTE',
                     'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]': reserva.estado === 'COMPLETADA',
                     'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]': reserva.estado === 'CANCELADA' || reserva.estado === 'NO_ASISTIO'
                   }">
                <i class="pi text-obsidian text-sm"
                   [ngClass]="{
                     'pi-clock': reserva.estado === 'PENDIENTE',
                     'pi-check-circle': reserva.estado === 'COMPLETADA',
                     'pi-times-circle': reserva.estado === 'CANCELADA' || reserva.estado === 'NO_ASISTIO'
                   }">
                </i>
              </div>

              <!-- Tarjeta de Reserva -->
              <div class="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] glass-card p-6 rounded-2xl border transition-all duration-300 hover:shadow-[0_15px_40px_rgba(212,175,55,0.15)] transform translate-z-12 group-hover:rotate-y-2"
                   [ngClass]="{
                     'border-amber-500/40': reserva.estado === 'PENDIENTE',
                     'border-emerald-500/40 opacity-70': reserva.estado === 'COMPLETADA',
                     'border-red-500/40 opacity-50': reserva.estado === 'CANCELADA' || reserva.estado === 'NO_ASISTIO',
                     'border-zinc-700/50': !reserva.estado
                   }">
                
                <div class="flex justify-between items-start mb-3">
                  <div class="space-y-1">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border"
                          [ngClass]="{
                            'bg-amber-500/20 text-amber-400 border-amber-500/30': reserva.estado === 'PENDIENTE',
                            'bg-emerald-500/20 text-emerald-400 border-emerald-500/30': reserva.estado === 'COMPLETADA',
                            'bg-red-500/20 text-red-400 border-red-500/30': reserva.estado === 'CANCELADA' || reserva.estado === 'NO_ASISTIO'
                          }">
                      {{ reserva.estado }}
                    </span>
                    <h4 class="text-xl font-bold text-white">{{ reserva.fechaHoraInicio | date:'EEEE d MMM, yyyy' }}</h4>
                    <p class="text-amber-400 font-bold"><i class="pi pi-clock text-xs mr-1"></i> {{ reserva.fechaHoraInicio | date:'HH:mm' }}</p>
                  </div>
                  <div class="text-right">
                    <span class="text-lg font-bold text-white">{{ reserva.precioTotalHist | currency:'USD':'symbol':'1.0-0' }}</span>
                  </div>
                </div>

                <div class="space-y-2 pt-3 border-t border-zinc-800/50">
                  <p class="text-xs text-zinc-400 uppercase font-bold tracking-widest">Servicios</p>
                  <ul class="space-y-1">
                    @for (detalle of reserva.detalles; track detalle.id) {
                      <li class="text-sm text-zinc-300 flex items-start gap-2">
                        <i class="pi pi-check text-amber-500 text-[10px] mt-1"></i>
                        <span>{{ detalle.nombreServicioHist }} ({{ detalle.duracionMinutosHist }} min)</span>
                      </li>
                    }
                  </ul>
                </div>

                @if (reserva.estado === 'PENDIENTE') {
                  <div class="pt-5 mt-2 flex justify-end gap-3 transform translate-z-8">
                    <button class="px-4 py-2 text-xs font-bold rounded-lg text-red-400 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300 transition-colors">
                      Cancelar Cita
                    </button>
                  </div>
                }

              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class MisReservasComponent implements OnInit {
  protected readonly reservasService = inject(ReservasService);
  
  reservas = signal<any[]>([]);

  ngOnInit() {
    this.reservasService.obtenerMisReservas().subscribe(data => {
      // Ordenar: Pendientes primero (o más cercanas primero), luego completadas/canceladas
      const ordenados = data.sort((a, b) => new Date(b.fechaHoraInicio).getTime() - new Date(a.fechaHoraInicio).getTime());
      this.reservas.set(ordenados);
    });
  }
}
