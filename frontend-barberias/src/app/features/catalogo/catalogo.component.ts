import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ServiciosService } from '../../core/services/servicios.service';
import { TenantService } from '../../core/services/tenant.service';

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
          Explora nuestros cortes clásicos, tratamientos premium y combos especiales diseñados para resaltar tu mejor estilo.
        </p>
      </section>

      <!-- Estado de Carga -->
      @if (serviciosService.isLoading()) {
        <div class="flex justify-center items-center py-24">
          <div class="relative">
            <i class="pi pi-spin pi-spinner text-5xl text-amber-500/50"></i>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="w-2 h-2 bg-amber-400 rounded-full animate-ping"></span>
            </div>
          </div>
        </div>
      }

      <!-- Grid de Servicios (3D Tilt) -->
      @if (!serviciosService.isLoading() && serviciosService.servicios().length > 0) {
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto px-4 transform-style-3d">
          @for (servicio of serviciosService.servicios(); track servicio.id) {
            <div class="glass-card rounded-3xl p-6 relative overflow-hidden group hover:-translate-y-4 hover:rotate-x-2 hover:-rotate-y-2 transition-all duration-500 shadow-[0_15px_40px_rgba(0,0,0,0.4)] transform-style-3d hover:shadow-[0_20px_50px_rgba(212,175,55,0.15)] flex flex-col h-full">
              
              <!-- Background Glow en hover -->
              <div class="absolute -right-20 -top-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>

              <!-- Header Card -->
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

              <!-- Content -->
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

              <!-- Footer Action -->
              <div class="pt-6 mt-auto transform translate-z-12">
                <button class="w-full py-3.5 rounded-xl text-sm font-bold text-zinc-300 border border-zinc-700/80 bg-zinc-800/50 hover:bg-zinc-800 hover:border-amber-500/50 hover:text-amber-400 transition-all flex items-center justify-center gap-2 group-hover:shadow-[0_0_20px_rgba(212,175,55,0.2)]">
                  <i class="pi pi-calendar-plus"></i> Reservar Este Servicio
                </button>
              </div>
            </div>
          }
        </section>
      }

      <!-- Empty State -->
      @if (!serviciosService.isLoading() && serviciosService.servicios().length === 0) {
        <div class="max-w-md mx-auto px-4 text-center space-y-6 transform translate-z-12 pt-10">
          <div class="w-24 h-24 mx-auto rounded-[2rem] bg-zinc-800/40 border border-zinc-700/50 flex items-center justify-center text-4xl text-zinc-600 shadow-inner">
            <i class="pi pi-folder-open"></i>
          </div>
          <div class="space-y-2">
            <h3 class="text-xl font-bold text-white">Catálogo Vacío</h3>
            <p class="text-zinc-400 text-sm">
              Esta barbería aún no ha publicado servicios en su catálogo. Por favor, vuelve más tarde.
            </p>
          </div>
          <button routerLink="/barberias" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform flex items-center justify-center gap-2 mx-auto">
            <i class="pi pi-arrow-left"></i> Volver a Barberías
          </button>
        </div>
      }

    </div>
  `
})
export class CatalogoComponent implements OnInit {
  protected readonly serviciosService = inject(ServiciosService);
  protected readonly tenantService = inject(TenantService);

  ngOnInit() {
    this.serviciosService.cargarServicios().subscribe();
  }
}
