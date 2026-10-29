import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ServiciosService } from '../../core/services/servicios.service';
import {
  CatalogoHibridoService,
  CategoriaDelCatalogo,
  ServicioDeCatalogo,
} from '../../core/services/catalogo-hibrido.service';
import { TenantService } from '../../core/services/tenant.service';

/** Los servicios de una categoría agrupados por el barbero que los realiza. */
interface GrupoDeBarbero {
  barberoId: string;
  barberoNombre: string;
  servicios: ServicioDeCatalogo[];
}

/**
 * Vitrina del cliente (V3 · catálogo híbrido).
 *
 * Navega PRIMERO por categorías —las define el ADMIN de la sede— y dentro de cada
 * una muestra los servicios de los barberos, cada uno con su precio y su
 * duración. Es lo que devuelve `GET /shops/:shopId/servicios` ya anidado; el
 * backend omite las categorías inactivas y las que no tienen servicios activos,
 * así que aquí no hay que filtrar nada.
 *
 * El catálogo heredado (`GET /shops/:shopId/services`) se mantiene como RESPALDO
 * visual: una sede que todavía no publicó servicios híbridos sigue teniendo
 * cartelera en vez de una pantalla vacía. La reserva sigue creándose contra ese
 * catálogo heredado, por eso el botón de reservar lleva al asistente y no
 * promete un flujo que el backend aún no acepta.
 */
@Component({
  selector: 'app-catalogo',
  standalone: true,
  imports: [CommonModule, RouterLink, CurrencyPipe],
  template: `
    <div class="min-h-screen space-y-12 py-10 perspective-1200 bg-ambient-mesh">

      <!-- Header 3D -->
      <section class="max-w-6xl mx-auto px-4 text-center space-y-4">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-widest mb-2 shadow-[0_0_20px_rgba(212,175,55,0.2)] transform translate-z-12">
          <i class="pi pi-list"></i>
          <span>{{ tenantService.nombreBarberiaActiva() }}</span>
        </div>

        <h2 class="text-4xl sm:text-5xl lg:text-6xl font-display font-extrabold text-white transform translate-z-24 drop-shadow-2xl">
          Catálogo de <span class="gold-gradient-text">Servicios</span>
        </h2>
        <p class="text-zinc-400 max-w-2xl mx-auto text-sm sm:text-base transform translate-z-8">
          Elige una categoría y descubre los servicios que ofrecen nuestros barberos, con su precio y
          su duración.
        </p>

        @if (categorias().length > 0) {
          <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
            <span class="px-3 py-1 rounded-full text-[11px] font-bold bg-zinc-800/80 text-zinc-300 border border-zinc-700">
              {{ categorias().length }} categoría{{ categorias().length === 1 ? '' : 's' }}
            </span>
            <span class="px-3 py-1 rounded-full text-[11px] font-bold bg-zinc-800/80 text-zinc-300 border border-zinc-700">
              {{ totalServicios() }} servicio{{ totalServicios() === 1 ? '' : 's' }} disponible{{ totalServicios() === 1 ? '' : 's' }}
            </span>
          </div>
        }
      </section>

      <!-- Cargando -->
      @if (catalogoService.cargandoCatalogo()) {
        <div class="flex justify-center items-center py-24">
          <div class="relative">
            <i class="pi pi-spin pi-spinner text-5xl text-amber-500/50"></i>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="w-2 h-2 bg-amber-400 rounded-full animate-ping"></span>
            </div>
          </div>
        </div>
      }

      <!-- Error de la API (incluye el 403 de otro sede y el 409 del contrato D40) -->
      @if (catalogoService.errorCatalogo()) {
        <div class="max-w-3xl mx-auto px-4">
          <div
            class="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3"
            role="alert"
          >
            <i class="pi pi-exclamation-triangle mt-0.5"></i>
            <span class="flex-1">{{ catalogoService.errorCatalogo() }}</span>
            <button (click)="recargar()" class="text-rose-200 hover:text-white underline text-xs font-bold">
              Reintentar
            </button>
          </div>
        </div>
      }

      <!-- Categorías expandibles (catálogo híbrido) -->
      @if (!catalogoService.cargandoCatalogo() && categorias().length > 0) {
        <section class="max-w-6xl mx-auto px-4 space-y-4 transform-style-3d">
          @for (categoria of categorias(); track categoria.id) {
            <div class="glass-card rounded-3xl border border-white/5 overflow-hidden">
              <button
                (click)="alternarCategoria(categoria.id)"
                class="w-full flex items-center gap-4 p-5 text-left hover:bg-white/[0.03] transition-colors"
                [attr.aria-expanded]="estaAbierta(categoria.id)"
              >
                <div
                  class="w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0"
                  [class.bg-amber-500/15]="estaAbierta(categoria.id)"
                  [class.border-amber-500/40]="estaAbierta(categoria.id)"
                  [class.text-amber-400]="estaAbierta(categoria.id)"
                  [class.bg-zinc-800/60]="!estaAbierta(categoria.id)"
                  [class.border-zinc-700]="!estaAbierta(categoria.id)"
                  [class.text-zinc-400]="!estaAbierta(categoria.id)"
                >
                  <i class="pi pi-tags"></i>
                </div>

                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-bold text-white truncate">{{ categoria.nombre }}</h3>
                  <p class="text-xs text-zinc-400 truncate">
                    {{ categoria.descripcion || 'Servicios de esta categoría' }}
                  </p>
                </div>

                <span class="hidden sm:inline-flex px-3 py-1 rounded-full text-[11px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {{ categoria.servicios.length }} servicio{{ categoria.servicios.length === 1 ? '' : 's' }}
                </span>

                <i
                  class="pi text-zinc-500 transition-transform"
                  [ngClass]="estaAbierta(categoria.id) ? 'pi-chevron-up' : 'pi-chevron-down'"
                ></i>
              </button>

              @if (estaAbierta(categoria.id)) {
                <div class="px-5 pb-5 space-y-5 border-t border-white/5 pt-5">
                  @for (grupo of gruposDeBarbero(categoria); track grupo.barberoId) {
                    <div class="space-y-3">
                      <div class="flex items-center gap-2">
                        <span class="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400/25 to-amber-600/25 border border-amber-500/30 flex items-center justify-center text-amber-300 text-[11px] font-bold">
                          {{ inicial(grupo.barberoNombre) }}
                        </span>
                        <p class="text-xs font-bold uppercase tracking-wider text-amber-400/90">
                          {{ grupo.barberoNombre }}
                        </p>
                      </div>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        @for (servicio of grupo.servicios; track servicio.id) {
                          <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex items-center gap-4 hover:border-amber-500/40 transition-colors">
                            <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400 shrink-0">
                              <i class="pi pi-scissors"></i>
                            </div>
                            <div class="flex-1 min-w-0">
                              <h4 class="font-bold text-white truncate" [title]="servicio.nombre">
                                {{ servicio.nombre }}
                              </h4>
                              <p class="text-[11px] text-zinc-500">
                                <i class="pi pi-clock text-[9px] mr-1"></i>{{ servicio.duracionMinutos }} min
                              </p>
                            </div>
                            <div class="text-right shrink-0">
                              <p class="text-lg font-bold text-amber-400">
                                {{ servicio.precio | currency:'USD':'symbol':'1.0-2' }}
                              </p>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <div class="flex justify-center pt-4">
            <button
              routerLink="/reservas/nueva"
              class="px-8 py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_0_30px_rgba(212,175,55,0.35)] hover:scale-105 transition-transform flex items-center gap-2"
            >
              <i class="pi pi-calendar-plus"></i> Reservar una cita
            </button>
          </div>
        </section>
      }

      <!-- Respaldo: catálogo heredado mientras la sede no tenga servicios híbridos -->
      @if (!catalogoService.cargandoCatalogo() && categorias().length === 0) {
        @if (serviciosService.isLoading()) {
          <div class="flex justify-center items-center py-16">
            <i class="pi pi-spin pi-spinner text-4xl text-amber-500/50"></i>
          </div>
        }

        @if (!serviciosService.isLoading() && serviciosService.servicios().length > 0) {
          <section class="max-w-6xl mx-auto px-4 space-y-5">
            <p class="text-center text-xs text-zinc-500">
              Esta sede todavía no organizó su catálogo por categorías; te mostramos su carta de servicios.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 transform-style-3d">
              @for (servicio of serviciosService.servicios(); track servicio.id) {
                <div class="glass-card rounded-3xl p-6 relative overflow-hidden group hover:-translate-y-4 transition-all duration-500 shadow-[0_15px_40px_rgba(0,0,0,0.4)] transform-style-3d flex flex-col h-full">
                  <div class="absolute -right-20 -top-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>

                  <div class="flex justify-between items-start mb-6 transform translate-z-12">
                    <div class="w-12 h-12 rounded-2xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center text-amber-400 text-xl shadow-inner group-hover:bg-amber-500/20 group-hover:border-amber-500/40 transition-colors">
                      <i [class]="servicio.esCombo ? 'pi pi-star' : 'pi pi-tag'"></i>
                    </div>
                    <div class="text-right">
                      <div class="text-2xl font-display font-bold text-white group-hover:text-amber-300 transition-colors">
                        {{ servicio.precio | currency:'USD':'symbol':'1.0-0' }}
                      </div>
                      <div class="text-xs text-zinc-500 font-medium tracking-wide">{{ servicio.duracionMinutos }} MIN</div>
                    </div>
                  </div>

                  <div class="flex-grow space-y-2 transform translate-z-24">
                    <h3 class="text-xl font-bold text-white leading-tight flex items-center gap-2">
                      {{ servicio.nombre }}
                      @if (servicio.esCombo) {
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider">COMBO</span>
                      }
                    </h3>
                    <p class="text-sm text-zinc-400 leading-relaxed line-clamp-3">
                      {{ servicio.descripcion || 'Servicio profesional de barbería.' }}
                    </p>
                  </div>

                  <div class="pt-6 mt-auto transform translate-z-12">
                    <a routerLink="/reservas/nueva" class="w-full py-3.5 rounded-xl text-sm font-bold text-zinc-300 border border-zinc-700/80 bg-zinc-800/50 hover:bg-zinc-800 hover:border-amber-500/50 hover:text-amber-400 transition-all flex items-center justify-center gap-2">
                      <i class="pi pi-calendar-plus"></i> Reservar Este Servicio
                    </a>
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <!-- Vacío de verdad: ni catálogo híbrido ni heredado -->
        @if (!serviciosService.isLoading() && serviciosService.servicios().length === 0) {
          <div class="max-w-md mx-auto px-4 text-center space-y-6 transform translate-z-12 pt-6">
            <div class="w-24 h-24 mx-auto rounded-[2rem] bg-zinc-800/40 border border-zinc-700/50 flex items-center justify-center text-4xl text-zinc-600 shadow-inner">
              <i class="pi pi-folder-open"></i>
            </div>
            <div class="space-y-2">
              <h3 class="text-xl font-bold text-white">Catálogo vacío</h3>
              <p class="text-zinc-400 text-sm">
                Esta barbería aún no ha publicado servicios. Vuelve más tarde o consulta con la sede.
              </p>
            </div>
            <a routerLink="/barberias" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform inline-flex items-center justify-center gap-2">
              <i class="pi pi-arrow-left"></i> Volver a Barberías
            </a>
          </div>
        }
      }

    </div>
  `
})
export class CatalogoComponent implements OnInit {
  protected readonly catalogoService = inject(CatalogoHibridoService);
  protected readonly serviciosService = inject(ServiciosService);
  protected readonly tenantService = inject(TenantService);

  /** Ids de categoría desplegadas; el conjunto evita re-renderizar el @for. */
  readonly categoriasAbiertas = signal<Set<string>>(new Set());

  readonly categorias = computed(() => this.catalogoService.catalogo());

  readonly totalServicios = computed(() =>
    this.categorias().reduce((acc, categoria) => acc + categoria.servicios.length, 0),
  );

  ngOnInit(): void {
    // Los dos catálogos se piden en paralelo: el híbrido manda y el heredado
    // hace de respaldo, así que la pantalla nunca queda en blanco mientras uno
    // de los dos responda.
    this.cargar();
  }

  recargar(): void {
    this.cargar();
  }

  private cargar(): void {
    this.serviciosService.cargarServicios().subscribe();
    this.catalogoService.cargarCatalogo().subscribe({
      next: (categorias) => {
        // La primera categoría se abre sola: el cliente ve contenido sin tener
        // que adivinar que las filas son desplegables.
        const primera = categorias[0];
        this.categoriasAbiertas.set(primera ? new Set([primera.id]) : new Set());
      },
      error: () => this.categoriasAbiertas.set(new Set()),
    });
  }

  alternarCategoria(id: string): void {
    const abiertas = new Set(this.categoriasAbiertas());
    if (abiertas.has(id)) {
      abiertas.delete(id);
    } else {
      abiertas.add(id);
    }
    this.categoriasAbiertas.set(abiertas);
  }

  estaAbierta(id: string): boolean {
    return this.categoriasAbiertas().has(id);
  }

  /**
   * Agrupa los servicios de una categoría por barbero. Un mismo servicio puede
   * repetirse entre barberos con precios distintos: el modelo permite que cada
   * uno ponga su tarifa, así que se muestran separados y no como duplicados.
   */
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
}
