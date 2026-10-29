import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ServiciosService, Servicio } from '../../core/services/servicios.service';
import { ReservasService, DisponibilidadSlot } from '../../core/services/reservas.service';
import {
  CatalogoHibridoService,
  CategoriaDelCatalogo,
  ServicioDeCatalogo,
} from '../../core/services/catalogo-hibrido.service';
import { TenantService } from '../../core/services/tenant.service';
import { FormsModule } from '@angular/forms';

/** Servicio elegido, ya sea del catálogo híbrido o del heredado. */
interface ServicioElegido {
  id: string;
  nombre: string;
  precio: number;
  duracionMinutos: number;
}

/** Los servicios de una categoría agrupados por el barbero que los realiza. */
interface GrupoDeBarbero {
  barberoId: string;
  barberoNombre: string;
  servicios: ServicioDeCatalogo[];
}

/**
 * Asistente de reservas del CLIENTE.
 *
 * V3 fase 4 · el paso 1 navega en el orden que impone el catálogo híbrido:
 * **categoría → barbero → servicios de ese barbero**. La reserva se envía con
 * `serviciosBarberoIds` y `barberoId`, y el backend calcula el precio y la
 * duración sumando lo que el barbero publicó (el cliente no los decide).
 *
 * Si la sede todavía no publicó servicios propios, el paso 1 cae al catálogo
 * heredado de siempre y la reserva viaja con `serviciosIds`: el asistente no
 * deja de funcionar por una migración a medias.
 */
@Component({
  selector: 'app-reserva-wizard',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
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

        <!-- PASO 1: Categoría → Barbero → Servicios -->
        <div class="transition-all duration-500 absolute inset-0 w-full"
             [class.translate-x-0]="currentStep() === 1"
             [class.opacity-100]="currentStep() === 1"
             [class.pointer-events-auto]="currentStep() === 1"
             [class.-translate-x-full]="currentStep() > 1"
             [class.translate-x-full]="currentStep() < 1"
             [class.opacity-0]="currentStep() !== 1"
             [class.pointer-events-none]="currentStep() !== 1">

          <div class="space-y-6">
            <div>
              <h3 class="text-2xl font-bold text-white mb-1">
                ¿Qué te vas a hacer?
                <span class="gold-gradient-text">{{ tenantService.nombreBarberiaActiva() }}</span>
              </h3>
              <p class="text-sm text-zinc-400">
                @if (modoHibrido()) {
                  Elige una categoría, luego el barbero y por último sus servicios.
                } @else {
                  Elige los servicios que quieres reservar.
                }
              </p>
            </div>

            <!-- Cargando catálogo híbrido -->
            @if (catalogoService.cargandoCatalogo() && !modoHibrido()) {
              <div class="flex flex-col items-center justify-center py-16 gap-3">
                <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
                <p class="text-xs text-zinc-500">Cargando el catálogo...</p>
              </div>
            }

            <!-- Error del catálogo (403 de otra sede, 409 D40, red) -->
            @if (catalogoService.errorCatalogo() && !modoHibrido()) {
              <div class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-2" role="alert">
                <i class="pi pi-exclamation-triangle mt-0.5"></i>
                <span class="flex-1">{{ catalogoService.errorCatalogo() }}</span>
              </div>
            }

            @if (modoHibrido()) {
              <!-- 1 · Categorías -->
              <div class="space-y-3">
                <p class="text-[11px] font-bold uppercase tracking-widest text-amber-400">1 · Categoría</p>
                <div class="flex flex-wrap gap-2">
                  @for (categoria of categorias(); track categoria.id) {
                    <button (click)="elegirCategoria(categoria.id)"
                            class="px-4 py-2 rounded-xl text-sm font-bold border transition-all"
                            [class.border-amber-500]="categoriaSeleccionadaId() === categoria.id"
                            [class.bg-amber-500/15]="categoriaSeleccionadaId() === categoria.id"
                            [class.text-amber-300]="categoriaSeleccionadaId() === categoria.id"
                            [class.border-zinc-700]="categoriaSeleccionadaId() !== categoria.id"
                            [class.text-zinc-300]="categoriaSeleccionadaId() !== categoria.id"
                            [class.bg-zinc-900/60]="categoriaSeleccionadaId() !== categoria.id">
                      {{ categoria.nombre }}
                      <span class="text-[10px] text-zinc-500 font-medium">({{ categoria.servicios.length }})</span>
                    </button>
                  }
                </div>
              </div>

              @if (categoriaActiva(); as categoria) {
                <!-- 2 · Barbero -->
                <div class="space-y-3">
                  <p class="text-[11px] font-bold uppercase tracking-widest text-amber-400">2 · Barbero</p>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    @for (grupo of gruposDeBarbero(categoria); track grupo.barberoId) {
                      <button (click)="elegirBarbero(grupo.barberoId)"
                              class="flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all"
                              [class.border-amber-500]="barberoSeleccionadoId() === grupo.barberoId"
                              [class.bg-amber-500/10]="barberoSeleccionadoId() === grupo.barberoId"
                              [class.border-zinc-700]="barberoSeleccionadoId() !== grupo.barberoId"
                              [class.bg-zinc-900/50]="barberoSeleccionadoId() !== grupo.barberoId">
                        <span class="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400/25 to-amber-600/25 border border-amber-500/30 flex items-center justify-center text-amber-300 text-xs font-bold shrink-0">
                          {{ inicial(grupo.barberoNombre) }}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-sm font-bold text-white truncate">{{ grupo.barberoNombre }}</span>
                          <span class="block text-[11px] text-zinc-500">
                            {{ grupo.servicios.length }} servicio{{ grupo.servicios.length === 1 ? '' : 's' }}
                          </span>
                        </span>
                        @if (barberoSeleccionadoId() === grupo.barberoId) {
                          <i class="pi pi-check-circle text-amber-400"></i>
                        }
                      </button>
                    }
                  </div>
                </div>
              }

              @if (grupoSeleccionado(); as grupo) {
                <!-- 3 · Servicios del barbero -->
                <div class="space-y-3">
                  <p class="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                    3 · Servicios de {{ grupo.barberoNombre }}
                  </p>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    @for (servicio of grupo.servicios; track servicio.id) {
                      <div (click)="toggleServicioHibrido(servicio.id)"
                           class="glass-card p-5 rounded-2xl cursor-pointer border transition-all duration-300 flex items-center gap-4 group hover:scale-[1.02]"
                           [class.border-amber-500]="estaElegidoHibrido(servicio.id)"
                           [class.bg-amber-500/10]="estaElegidoHibrido(servicio.id)"
                           [class.border-zinc-700]="!estaElegidoHibrido(servicio.id)">
                        <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                             [class.border-amber-500]="estaElegidoHibrido(servicio.id)"
                             [class.bg-amber-500]="estaElegidoHibrido(servicio.id)"
                             [class.border-zinc-500]="!estaElegidoHibrido(servicio.id)">
                          <i class="pi pi-check text-xs text-zinc-950"
                             [class.opacity-100]="estaElegidoHibrido(servicio.id)"
                             [class.opacity-0]="!estaElegidoHibrido(servicio.id)"></i>
                        </div>
                        <div class="flex-grow min-w-0">
                          <h4 class="font-bold text-white group-hover:text-amber-300 transition-colors truncate">{{ servicio.nombre }}</h4>
                          <p class="text-xs text-zinc-400">{{ servicio.duracionMinutos }} min</p>
                        </div>
                        <div class="font-bold text-amber-400 shrink-0">
                          {{ servicio.precio | currency:'USD':'symbol':'1.0-2' }}
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              @if (!categoriaSeleccionadaId()) {
                <p class="text-zinc-500 text-sm italic text-center py-6">
                  Selecciona una categoría para ver los barberos que la ofrecen.
                </p>
              } @else if (!barberoSeleccionadoId()) {
                <p class="text-zinc-500 text-sm italic text-center py-6">
                  Elige un barbero para ver sus servicios.
                </p>
              }
            } @else if (serviciosService.isLoading()) {
              <div class="flex justify-center py-16">
                <i class="pi pi-spin pi-spinner text-4xl text-amber-500/70"></i>
              </div>
            } @else {
              <!-- Catálogo heredado (sede sin servicios híbridos) -->
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
                @if (modoHibrido() && grupoSeleccionado(); as grupo) {
                  <p class="text-xs text-zinc-500">
                    Disponibilidad de <span class="text-zinc-300 font-semibold">{{ grupo.barberoNombre }}</span>
                  </p>
                }
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
             [class.-translate-x-full]="currentStep() > 3"
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

              @if (modoHibrido() && grupoSeleccionado(); as grupo) {
                <div class="flex items-center gap-4 bg-zinc-900/50 p-4 rounded-xl border border-zinc-800">
                  <div class="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 text-xl">
                    <i class="pi pi-user"></i>
                  </div>
                  <div>
                    <p class="text-xs text-zinc-400 uppercase font-bold">Barbero</p>
                    <p class="text-white font-bold">{{ grupo.barberoNombre }}</p>
                  </div>
                </div>
              }

              <div class="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-3">
                <p class="text-xs text-zinc-400 uppercase font-bold border-b border-zinc-800 pb-2">Servicios Seleccionados</p>
                @for (s of serviciosElegidos(); track s.id) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-zinc-200">{{ s.nombre }} <span class="text-zinc-500 text-xs">· {{ s.duracionMinutos }} min</span></span>
                    <span class="text-amber-400 font-bold">{{ s.precio | currency:'USD':'symbol':'1.0-2' }}</span>
                  </div>
                }
                <div class="flex justify-between items-center pt-3 border-t border-zinc-800 mt-3">
                  <span class="text-white font-bold uppercase tracking-widest text-xs">Total a Pagar</span>
                  <span class="text-2xl font-bold text-white drop-shadow-md">{{ precioTotal() | currency:'USD':'symbol':'1.0-2' }}</span>
                </div>
                <p class="text-[11px] text-zinc-500">
                  Duración estimada: {{ duracionTotal() }} min. El total lo confirma el servidor con el catálogo del barbero.
                </p>
              </div>

              @if (reservasService.error()) {
                <div class="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center" role="alert">
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
  protected readonly catalogoService = inject(CatalogoHibridoService);
  protected readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);

  steps = [
    { num: 1, title: 'Servicios' },
    { num: 2, title: 'Horario' },
    { num: 3, title: 'Confirmar' }
  ];

  currentStep = signal(1);

  // ── Paso 1 · catálogo híbrido ───────────────────────────────────────────
  readonly categoriaSeleccionadaId = signal<string | null>(null);
  readonly barberoSeleccionadoId = signal<string | null>(null);
  readonly seleccionHibrida = signal<Set<string>>(new Set());

  // ── Paso 1 · catálogo heredado (respaldo) ───────────────────────────────
  selectedServicioIds = signal<Set<string>>(new Set());

  // ── Paso 2 ──────────────────────────────────────────────────────────────
  fechaSeleccionada: string = new Date().toISOString().split('T')[0];
  slotsDisponibles = signal<DisponibilidadSlot[]>([]);
  slotSeleccionado = signal<string | null>(null);

  readonly categorias = computed(() => this.catalogoService.catalogo());

  /** Con catálogo híbrido el paso 1 es categoría → barbero → servicios. */
  readonly modoHibrido = computed(() => this.categorias().length > 0);

  readonly categoriaActiva = computed<CategoriaDelCatalogo | null>(() => {
    const id = this.categoriaSeleccionadaId();
    return this.categorias().find((categoria) => categoria.id === id) ?? null;
  });

  readonly grupoSeleccionado = computed<GrupoDeBarbero | null>(() => {
    const categoria = this.categoriaActiva();
    const barberoId = this.barberoSeleccionadoId();
    if (!categoria || !barberoId) return null;
    return this.gruposDeBarbero(categoria).find((grupo) => grupo.barberoId === barberoId) ?? null;
  });

  readonly serviciosElegidos = computed<ServicioElegido[]>(() => {
    if (this.modoHibrido()) {
      const ids = this.seleccionHibrida();
      return this.categorias()
        .flatMap((categoria) => categoria.servicios)
        .filter((servicio) => ids.has(servicio.id))
        .map((servicio) => ({
          id: servicio.id,
          nombre: servicio.nombre,
          precio: servicio.precio,
          duracionMinutos: servicio.duracionMinutos,
        }));
    }

    return this.serviciosService
      .servicios()
      .filter((servicio) => this.selectedServicioIds().has(servicio.id))
      .map((servicio) => ({
        id: servicio.id,
        nombre: servicio.nombre,
        precio: servicio.precio,
        duracionMinutos: servicio.duracionMinutos,
      }));
  });

  readonly duracionTotal = computed(() =>
    this.serviciosElegidos().reduce((acc, servicio) => acc + servicio.duracionMinutos, 0),
  );

  readonly precioTotal = computed(() =>
    this.serviciosElegidos().reduce((acc, servicio) => acc + servicio.precio, 0),
  );

  ngOnInit(): void {
    // El híbrido manda; el heredado se pide igual para poder reservar en las
    // sedes que todavía no migraron su catálogo.
    this.serviciosService.cargarServicios().subscribe();
    this.catalogoService.cargarCatalogo().subscribe({
      next: (categorias) => {
        // Si hay catálogo híbrido, se preselecciona la primera categoría: el
        // cliente ve contenido en vez de tres bloques vacíos.
        this.categoriaSeleccionadaId.set(categorias[0]?.id ?? null);
        this.barberoSeleccionadoId.set(null);
        this.seleccionHibrida.set(new Set());
      },
    });
  }

  // ── Paso 1 · navegación por el catálogo híbrido ─────────────────────────

  elegirCategoria(id: string): void {
    this.categoriaSeleccionadaId.set(id);
    // Cambiar de categoría invalida el barbero y la selección: los servicios
    // elegidos podrían no existir en la nueva.
    this.barberoSeleccionadoId.set(null);
    this.seleccionHibrida.set(new Set());
  }

  elegirBarbero(id: string): void {
    this.barberoSeleccionadoId.set(id);
    // Los servicios de otro barbero no se pueden mezclar en una misma cita
    // híbrida: la reserva declara un único `barberoId`.
    this.seleccionHibrida.set(new Set());
  }

  toggleServicioHibrido(id: string): void {
    const seleccion = new Set(this.seleccionHibrida());
    if (seleccion.has(id)) {
      seleccion.delete(id);
    } else {
      seleccion.add(id);
    }
    this.seleccionHibrida.set(seleccion);
  }

  estaElegidoHibrido(id: string): boolean {
    return this.seleccionHibrida().has(id);
  }

  gruposDeBarbero(categoria: CategoriaDelCatalogo): GrupoDeBarbero[] {
    const porBarbero = new Map<string, GrupoDeBarbero>();

    for (const servicio of categoria.servicios) {
      const id = servicio.barbero.id || servicio.barbero.nombre;
      const grupo = porBarbero.get(id) ?? {
        barberoId: id,
        barberoNombre: servicio.barbero.nombre,
        servicios: [],
      };
      grupo.servicios.push(servicio);
      porBarbero.set(id, grupo);
    }

    return Array.from(porBarbero.values());
  }

  inicial(nombre: string): string {
    return (nombre || 'B').charAt(0).toUpperCase();
  }

  // ── Paso 1 · catálogo heredado ──────────────────────────────────────────

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

  // ── Paso 2 ──────────────────────────────────────────────────────────────

  buscarDisponibilidad() {
    if (!this.fechaSeleccionada || this.duracionTotal() === 0) return;

    this.slotSeleccionado.set(null);
    // En el flujo híbrido los huecos son los del barbero elegido: mostrar los de
    // la sede entera llevaría al cliente a un 409 al confirmar.
    const barberoId = this.modoHibrido() ? (this.barberoSeleccionadoId() ?? undefined) : undefined;

    this.reservasService.obtenerDisponibilidad(this.fechaSeleccionada, this.duracionTotal(), barberoId)
      .subscribe(slots => {
        this.slotsDisponibles.set(slots);
      });
  }

  // ── Navegación ──────────────────────────────────────────────────────────

  canProceed(): boolean {
    if (this.currentStep() === 1) {
      if (this.modoHibrido()) {
        return this.seleccionHibrida().size > 0 && !!this.barberoSeleccionadoId();
      }
      return this.selectedServicioIds().size > 0;
    }
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

  /**
   * El payload declara UN catálogo: `serviciosBarberoIds` + `barberoId` en el
   * híbrido, o `serviciosIds` en el heredado. El backend rechaza la mezcla con
   * 400 `CATALOGO_AMBIGUO` y calcula el precio y la duración por su cuenta.
   */
  confirmarReserva() {
    if (!this.slotSeleccionado()) return;

    // Find the slot to get the end time
    const slot = this.slotsDisponibles().find(s => s.inicio === this.slotSeleccionado());
    if (!slot) return;

    const fechaObj = new Date(this.slotSeleccionado()!);
    const fechaStr = fechaObj.toISOString().split('T')[0];
    const horaInicioStr = fechaObj.toTimeString().substring(0, 5); // HH:mm

    const fechaFinObj = new Date(slot.fin);
    const horaFinStr = fechaFinObj.toTimeString().substring(0, 5); // HH:mm

    const base = {
      fecha: fechaStr,
      horaInicio: horaInicioStr,
      horaFin: horaFinStr,
      precioTotalEsperado: this.precioTotal(),
    };

    const dto = this.modoHibrido()
      ? {
          ...base,
          serviciosBarberoIds: Array.from(this.seleccionHibrida()),
          barberoId: this.barberoSeleccionadoId(),
        }
      : {
          ...base,
          serviciosIds: Array.from(this.selectedServicioIds()),
        };

    this.reservasService.crearReserva(dto).subscribe({
      next: () => this.router.navigate(['/']),
      // El error ya queda en `reservasService.error()` y el paso 3 lo pinta:
      // 409 de hueco ocupado, 400 de servicio fuera de catálogo o 403 de sede.
      error: () => undefined,
    });
  }
}
