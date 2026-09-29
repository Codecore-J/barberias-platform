import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { ServiciosService, Servicio } from '../../core/services/servicios.service';
import { ReservasService, DisponibilidadSlot } from '../../core/services/reservas.service';
import { TenantService } from '../../core/services/tenant.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-reserva-wizard',
  standalone: true,
  imports: [CommonModule, RouterLink, CurrencyPipe, DatePipe, FormsModule],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh transform-style-3d perspective-1200">
      
      <!-- Stepper Header -->
      <div class="glass-panel rounded-2xl p-4 sm:p-6 mb-8 border border-amber-500/30 transform translate-z-12">
        <div class="flex items-center justify-between max-w-3xl mx-auto relative">
          <!-- Línea conectora -->
          <div class="absolute top-1/2 left-0 right-0 h-1 bg-zinc-800 -translate-y-1/2 z-0 rounded-full">
            <div class="h-full bg-amber-500 transition-all duration-500 rounded-full shadow-[0_0_10px_rgba(212,175,55,0.5)]"
                 [style.width]="((currentStep() - 1) / 2) * 100 + '%'"></div>
          </div>
          
          <!-- Steps -->
          @for (step of steps; track step.num) {
            <div class="relative z-10 flex flex-col items-center gap-2 transition-all duration-300"
                 [class.scale-110]="currentStep() === step.num"
                 [class.opacity-50]="currentStep() < step.num">
              <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors duration-300 shadow-lg"
                   [class.bg-amber-500]="currentStep() >= step.num"
                   [class.text-zinc-950]="currentStep() >= step.num"
                   [class.bg-zinc-800]="currentStep() < step.num"
                   [class.text-zinc-500]="currentStep() < step.num"
                   [class.shadow-[0_0_20px_rgba(212,175,55,0.4)]]="currentStep() === step.num">
                @if (currentStep() > step.num) {
                  <i class="pi pi-check"></i>
                } @else {
                  {{ step.num }}
                }
              </div>
              <span class="text-xs font-bold uppercase tracking-wider hidden sm:block"
                    [class.text-amber-400]="currentStep() === step.num"
                    [class.text-zinc-500]="currentStep() !== step.num">
                {{ step.title }}
              </span>
            </div>
          }
        </div>
      </div>

      <!-- Contenedor Principal con Transición -->
      <div class="relative overflow-hidden rounded-3xl transform-style-3d min-h-[60vh]">
        
        <!-- PASO 1: Servicios -->
        <div class="transition-all duration-500 absolute inset-0 w-full"
             [class.translate-x-0]="currentStep() === 1"
             [class.opacity-100]="currentStep() === 1"
             [class.pointer-events-auto]="currentStep() === 1"
             [class.-translate-x-full]="currentStep() > 1"
             [class.translate-x-full]="currentStep() < 1"
             [class.opacity-0]="currentStep() !== 1"
             [class.pointer-events-none]="currentStep() !== 1">
          
          <div class="space-y-6">
            <h3 class="text-2xl font-bold text-white mb-2">Selecciona los servicios</h3>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              @for (servicio of serviciosService.servicios(); track servicio.id) {
                <div (click)="toggleServicio(servicio)" 
                     class="glass-card p-5 rounded-2xl cursor-pointer border transition-all duration-300 transform-style-3d flex items-center gap-4 group hover:scale-[1.02]"
                     [class.border-amber-500]="isSelected(servicio.id)"
                     [class.bg-amber-500/10]="isSelected(servicio.id)"
                     [class.border-zinc-700]="!isSelected(servicio.id)">
                  
                  <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                       [class.border-amber-500]="isSelected(servicio.id)"
                       [class.bg-amber-500]="isSelected(servicio.id)"
                       [class.border-zinc-500]="!isSelected(servicio.id)">
                    <i class="pi pi-check text-xs text-zinc-950" [class.opacity-100]="isSelected(servicio.id)" [class.opacity-0]="!isSelected(servicio.id)"></i>
                  </div>
                  
                  <div class="flex-grow">
                    <h4 class="font-bold text-white group-hover:text-amber-300 transition-colors">{{ servicio.nombre }}</h4>
                    <p class="text-xs text-zinc-400">{{ servicio.duracionMinutos }} min</p>
                  </div>
                  
                  <div class="font-bold text-amber-400">
                    {{ servicio.precio | currency:'USD':'symbol':'1.0-0' }}
                  </div>
                </div>
              }
            </div>

            @if (serviciosService.servicios().length === 0) {
               <p class="text-zinc-500 text-center py-10">No hay servicios disponibles en esta barbería.</p>
            }
          </div>
        </div>

        <!-- PASO 2: Fecha y Hora -->
        <div class="transition-all duration-500 absolute inset-0 w-full"
             [class.translate-x-0]="currentStep() === 2"
             [class.opacity-100]="currentStep() === 2"
             [class.pointer-events-auto]="currentStep() === 2"
             [class.-translate-x-full]="currentStep() > 2"
             [class.translate-x-full]="currentStep() < 2"
             [class.opacity-0]="currentStep() !== 2"
             [class.pointer-events-none]="currentStep() !== 2">
          
          <div class="space-y-8">
            <h3 class="text-2xl font-bold text-white mb-2">Selecciona Fecha y Hora</h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <!-- Calendario Básico -->
              <div class="space-y-4">
                <label class="text-xs font-bold text-amber-400 uppercase tracking-widest">Día de la cita</label>
                <input type="date" [(ngModel)]="fechaSeleccionada" (change)="buscarDisponibilidad()"
                       class="w-full bg-zinc-900/80 border border-amber-500/30 rounded-xl p-4 text-white font-bold outline-none focus:border-amber-500 focus:shadow-[0_0_15px_rgba(212,175,55,0.3)] transition-all">
              </div>

              <!-- Slots -->
              <div class="space-y-4">
                <label class="text-xs font-bold text-amber-400 uppercase tracking-widest">Horarios Disponibles</label>
                
                @if (reservasService.isLoading()) {
                  <div class="py-10 text-center">
                    <i class="pi pi-spin pi-spinner text-3xl text-amber-500"></i>
                  </div>
                } @else {
                  <div class="grid grid-cols-3 gap-3">
                    @for (slot of slotsDisponibles(); track slot.inicio) {
                      <button (click)="slotSeleccionado.set(slot.inicio)"
                              class="py-3 rounded-xl text-sm font-bold border transition-all duration-300 hover:scale-105"
                              [class.border-amber-500]="slotSeleccionado() === slot.inicio"
                              [class.bg-amber-500/20]="slotSeleccionado() === slot.inicio"
                              [class.text-amber-400]="slotSeleccionado() === slot.inicio"
                              [class.border-zinc-700]="slotSeleccionado() !== slot.inicio"
                              [class.bg-zinc-800/50]="slotSeleccionado() !== slot.inicio"
                              [class.text-zinc-300]="slotSeleccionado() !== slot.inicio">
                        {{ slot.inicio | date:'HH:mm' }}
                      </button>
                    }
                  </div>
                  @if (slotsDisponibles().length === 0 && fechaSeleccionada) {
                    <p class="text-zinc-500 text-sm italic">No hay horarios disponibles para este día.</p>
                  }
                }
              </div>
            </div>
          </div>
        </div>

        <!-- PASO 3: Confirmación -->
        <div class="transition-all duration-500 absolute inset-0 w-full"
             [class.translate-x-0]="currentStep() === 3"
             [class.opacity-100]="currentStep() === 3"
             [class.pointer-events-auto]="currentStep() === 3"
             [class.translate-x-full]="currentStep() < 3"
             [class.opacity-0]="currentStep() !== 3"
             [class.pointer-events-none]="currentStep() !== 3">
          
          <div class="glass-panel max-w-xl mx-auto rounded-3xl p-8 border border-amber-500/50 shadow-[0_20px_50px_rgba(212,175,55,0.15)] relative overflow-hidden">
            <div class="absolute -top-20 -right-20 w-48 h-48 bg-amber-500/20 rounded-full blur-3xl"></div>
            
            <h3 class="text-3xl font-display font-bold text-white text-center mb-8 relative z-10">Resumen de tu Cita</h3>
            
            <div class="space-y-6 relative z-10">
              <div class="flex items-center gap-4 bg-zinc-900/50 p-4 rounded-xl border border-zinc-800">
                <div class="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 text-xl">
                  <i class="pi pi-calendar"></i>
                </div>
                <div>
                  <p class="text-xs text-zinc-400 uppercase font-bold">Fecha y Hora</p>
                  <p class="text-white font-bold">{{ slotSeleccionado() | date:'EEEE d MMMM, yyyy' }} a las {{ slotSeleccionado() | date:'HH:mm' }}</p>
                </div>
              </div>

              <div class="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-3">
                <p class="text-xs text-zinc-400 uppercase font-bold border-b border-zinc-800 pb-2">Servicios Seleccionados</p>
                @for (s of serviciosElegidos(); track s.id) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-zinc-200">{{ s.nombre }}</span>
                    <span class="text-amber-400 font-bold">{{ s.precio | currency:'USD':'symbol':'1.0-0' }}</span>
                  </div>
                }
                <div class="flex justify-between items-center pt-3 border-t border-zinc-800 mt-3">
                  <span class="text-white font-bold uppercase tracking-widest text-xs">Total a Pagar</span>
                  <span class="text-2xl font-bold text-white drop-shadow-md">{{ precioTotal() | currency:'USD':'symbol':'1.0-0' }}</span>
                </div>
              </div>

              @if (reservasService.error()) {
                <div class="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                  {{ reservasService.error() }}
                </div>
              }
            </div>
          </div>
        </div>

      </div>

      <!-- Controles Inferiores Flotantes -->
      <div class="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-obsidian to-transparent z-50 pointer-events-none">
        <div class="max-w-5xl mx-auto flex justify-between pointer-events-auto">
          
          <button (click)="prevStep()" [disabled]="currentStep() === 1"
                  class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-300 glass-card hover:bg-zinc-800 disabled:opacity-0 transition-all flex items-center gap-2">
            <i class="pi pi-arrow-left"></i> Atrás
          </button>
          
          @if (currentStep() < 3) {
            <button (click)="nextStep()" [disabled]="!canProceed()"
                    class="px-8 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:scale-105 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed transition-all flex items-center gap-2">
              Siguiente <i class="pi pi-arrow-right"></i>
            </button>
          } @else {
            <button (click)="confirmarReserva()" [disabled]="reservasService.isLoading()"
                    class="px-8 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_0_30px_rgba(212,175,55,0.5)] hover:scale-105 disabled:opacity-50 transition-all flex items-center gap-2">
              @if (reservasService.isLoading()) {
                <i class="pi pi-spin pi-spinner"></i> Procesando...
              } @else {
                <i class="pi pi-check-circle text-lg"></i> Confirmar Reserva
              }
            </button>
          }
        </div>
      </div>

    </div>
  `
})
export class ReservaWizardComponent implements OnInit {
  protected readonly serviciosService = inject(ServiciosService);
  protected readonly reservasService = inject(ReservasService);
  protected readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);

  steps = [
    { num: 1, title: 'Servicios' },
    { num: 2, title: 'Horario' },
    { num: 3, title: 'Confirmar' }
  ];

  currentStep = signal(1);

  // Estado Paso 1
  selectedServicioIds = signal<Set<string>>(new Set());
  
  // Estado Paso 2
  fechaSeleccionada: string = new Date().toISOString().split('T')[0];
  slotsDisponibles = signal<DisponibilidadSlot[]>([]);
  slotSeleccionado = signal<string | null>(null);

  // Computeds
  serviciosElegidos = computed(() => {
    return this.serviciosService.servicios().filter(s => this.selectedServicioIds().has(s.id));
  });
  
  duracionTotal = computed(() => {
    return this.serviciosElegidos().reduce((acc, curr) => acc + curr.duracionMinutos, 0);
  });

  precioTotal = computed(() => {
    return this.serviciosElegidos().reduce((acc, curr) => acc + curr.precio, 0);
  });

  ngOnInit() {
    this.serviciosService.cargarServicios().subscribe();
  }

  // Métodos Paso 1
  toggleServicio(servicio: Servicio) {
    const current = new Set(this.selectedServicioIds());
    if (current.has(servicio.id)) {
      current.delete(servicio.id);
    } else {
      current.add(servicio.id);
    }
    this.selectedServicioIds.set(current);
  }

  isSelected(id: string): boolean {
    return this.selectedServicioIds().has(id);
  }

  // Métodos Paso 2
  buscarDisponibilidad() {
    if (!this.fechaSeleccionada || this.duracionTotal() === 0) return;
    
    this.slotSeleccionado.set(null);
    this.reservasService.obtenerDisponibilidad(this.fechaSeleccionada, this.duracionTotal())
      .subscribe(slots => {
        this.slotsDisponibles.set(slots);
      });
  }

  // Navegación
  canProceed(): boolean {
    if (this.currentStep() === 1) return this.selectedServicioIds().size > 0;
    if (this.currentStep() === 2) return this.slotSeleccionado() !== null;
    return true;
  }

  nextStep() {
    if (this.canProceed() && this.currentStep() < 3) {
      if (this.currentStep() === 1) {
        this.buscarDisponibilidad();
      }
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep() {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  confirmarReserva() {
    if (!this.slotSeleccionado()) return;

    const dto = {
      servicioIds: Array.from(this.selectedServicioIds()),
      fechaHoraInicio: this.slotSeleccionado()!,
      // barberoId es opcional, lo dejamos null por ahora
    };

    this.reservasService.crearReserva(dto).subscribe(() => {
      // Redirigir al home con éxito
      this.router.navigate(['/']);
    });
  }
}
