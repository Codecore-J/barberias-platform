import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HorariosService, Horario } from '../../../core/services/horarios.service';
import { TenantService } from '../../../core/services/tenant.service';

interface DiaConfig {
  dia: number;
  nombre: string;
  activo: boolean;
  horaInicio: string;
  horaFin: string;
}

@Component({
  selector: 'app-admin-horarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-8 pb-12 animate-fade-in relative z-10">
      
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 relative">
        <div class="space-y-1">
          <h2 class="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight drop-shadow-md">
            Horarios de <span class="text-amber-400">Operación</span>
          </h2>
          <p class="text-zinc-400 text-sm sm:text-base">Define los días y horas en los que la barbería está abierta al público.</p>
        </div>
        
        <button (click)="guardarHorarios()"
                [disabled]="guardando()"
                class="px-6 py-2.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_5px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_10px_30px_rgba(212,175,55,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          <i class="pi" [ngClass]="guardando() ? 'pi-spin pi-spinner' : 'pi-save'"></i>
          <span class="ml-2">{{ guardando() ? 'Guardando...' : 'Guardar Horarios' }}</span>
        </button>
      </div>

      @if (mensajeExito()) {
        <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
        </div>
      }

      <div class="glass-panel p-6 rounded-3xl border border-white/5 space-y-4">
        
        <div class="hidden md:grid grid-cols-12 gap-4 pb-4 border-b border-white/5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          <div class="col-span-4">Día de la Semana</div>
          <div class="col-span-4">Apertura (HH:mm)</div>
          <div class="col-span-4">Cierre (HH:mm)</div>
        </div>

        <div class="space-y-4 md:space-y-2 mt-4">
          @for (dia of diasConfig; track dia.dia) {
            <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-4 md:p-2 rounded-xl"
                 [ngClass]="dia.activo ? 'bg-white/5 border border-white/10' : 'bg-transparent border border-transparent opacity-50'">
              
              <div class="col-span-1 md:col-span-4 flex items-center gap-3">
                <button (click)="toggleDia(dia)" 
                        class="w-10 h-6 rounded-full flex items-center p-1 transition-colors duration-300"
                        [ngClass]="dia.activo ? 'bg-amber-500' : 'bg-zinc-700'">
                  <div class="w-4 h-4 rounded-full bg-white transform transition-transform duration-300"
                       [ngClass]="dia.activo ? 'translate-x-4' : 'translate-x-0'"></div>
                </button>
                <span class="font-medium text-white">{{ dia.nombre }}</span>
                @if (!dia.activo) {
                  <span class="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded ml-2">Cerrado</span>
                }
              </div>

              <div class="col-span-1 md:col-span-4 flex flex-col md:block">
                <label class="md:hidden text-xs text-zinc-500 mb-1">Apertura</label>
                <input type="time" [(ngModel)]="dia.horaInicio" [disabled]="!dia.activo"
                       class="w-full bg-zinc-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-50">
              </div>

              <div class="col-span-1 md:col-span-4 flex flex-col md:block">
                <label class="md:hidden text-xs text-zinc-500 mb-1">Cierre</label>
                <input type="time" [(ngModel)]="dia.horaFin" [disabled]="!dia.activo"
                       class="w-full bg-zinc-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-50">
              </div>

            </div>
          }
        </div>

      </div>
    </div>
  `
})
export class AdminHorariosComponent implements OnInit {
  private tenantService = inject(TenantService);
  private horariosService = inject(HorariosService);

  guardando = signal(false);
  mensajeExito = signal('');

  diasConfig: DiaConfig[] = [
    { dia: 1, nombre: 'Lunes', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 2, nombre: 'Martes', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 3, nombre: 'Miércoles', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 4, nombre: 'Jueves', activo: true, horaInicio: '09:00', horaFin: '18:00' },
    { dia: 5, nombre: 'Viernes', activo: true, horaInicio: '09:00', horaFin: '19:00' },
    { dia: 6, nombre: 'Sábado', activo: true, horaInicio: '10:00', horaFin: '15:00' },
    { dia: 7, nombre: 'Domingo', activo: false, horaInicio: '10:00', horaFin: '14:00' },
  ];

  ngOnInit() {
    this.cargarHorariosActuales();
  }

  cargarHorariosActuales() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.horariosService.obtenerHorarios(barberia.id).subscribe({
      next: (horarios) => {
        if (horarios && horarios.length > 0) {
          // Resetear todos a false
          this.diasConfig.forEach(d => d.activo = false);
          
          // Aplicar los que vienen del backend
          horarios.forEach(h => {
            const config = this.diasConfig.find(d => d.dia === h.diaSemana);
            if (config) {
              config.activo = true;
              config.horaInicio = h.horaInicio;
              config.horaFin = h.horaFin;
            }
          });
        }
      }
    });
  }

  toggleDia(dia: DiaConfig) {
    dia.activo = !dia.activo;
  }

  guardarHorarios() {
    const barberia = this.tenantService.barberiaActiva();
    if (!barberia) return;

    this.guardando.set(true);
    this.mensajeExito.set('');

    const payload: Omit<Horario, 'id'>[] = this.diasConfig
      .filter(d => d.activo)
      .map(d => ({
        diaSemana: d.dia,
        horaInicio: d.horaInicio,
        horaFin: d.horaFin
      }));

    this.horariosService.configurarHorarios(barberia.id, payload).subscribe({
      next: () => {
        this.guardando.set(false);
        this.mensajeExito.set('Horarios guardados exitosamente.');
        setTimeout(() => this.mensajeExito.set(''), 4000);
      },
      error: () => {
        this.guardando.set(false);
      }
    });
  }
}
