import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="space-y-16 py-6 transform-style-3d">
      
      <!-- HERO 3D SECTION -->
      <section class="relative text-center max-w-4xl mx-auto pt-6 pb-8 space-y-6">
        
        <!-- Badge Superior Flotante -->
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-lg shadow-amber-500/10 hover:scale-105 transition-transform duration-300">
          <i class="pi pi-crown text-amber-400"></i>
          <span>Plataforma de Barberías Premium</span>
        </div>

        <!-- Título Principal con Efecto Dorado -->
        <h1 class="text-4xl sm:text-6xl lg:text-7xl font-display font-extrabold tracking-tight text-white leading-tight">
          La Experiencia Suprema en
          <span class="block gold-gradient-text">Corte, Cuidado y Estilo</span>
        </h1>

        <!-- Subtítulo -->
        <p class="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Agenda tus turnos en tiempo real con precisión milimétrica, consulta el catálogo de servicios de tu barbería favorita y accede a tu ficha técnica personalizada.
        </p>

        <!-- Botones de Acción Rápida 3D -->
        <div class="flex flex-wrap items-center justify-center gap-4 pt-4">
          <a routerLink="/reservas/nueva"
             class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-xl shadow-amber-500/25 hover:shadow-amber-500/40 hover:-translate-y-1 transition-all duration-300 flex items-center gap-2.5">
            <i class="pi pi-calendar-plus text-base"></i>
            <span>Agendar Cita Ahora</span>
          </a>

          <a routerLink="/barberias"
             class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/40 hover:-translate-y-1 transition-all duration-300 flex items-center gap-2.5">
            <i class="pi pi-building text-amber-400"></i>
            <span>Explorar Barberías</span>
          </a>
        </div>

      </section>

      <!-- BARBERÍA ACTIVA HIGHLIGHT BANNER -->
      @if (tenantService.barberiaActiva(); as barberia) {
        <section class="max-w-4xl mx-auto">
          <div class="glass-panel rounded-2xl p-6 sm:p-8 border border-amber-500/30 shadow-2xl relative overflow-hidden group">
            <div class="absolute -right-10 -bottom-10 w-44 h-44 bg-amber-500/10 rounded-full blur-2xl group-hover:scale-125 transition-transform duration-500"></div>
            
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span class="text-xs font-bold text-amber-400 uppercase tracking-widest">Barbería Activa Conectada</span>
                </div>
                <h3 class="text-2xl font-display font-bold text-white">{{ barberia.nombre }}</h3>
                <p class="text-xs text-zinc-400 flex items-center gap-2">
                  <i class="pi pi-map-marker text-amber-400"></i>{{ barberia.ubicacion }}
                  <span class="text-zinc-600">&bull;</span>
                  <i class="pi pi-phone text-amber-400"></i>{{ barberia.telefono }}
                </p>
              </div>

              <div class="flex items-center gap-3">
                <a routerLink="/catalogo" class="px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 hover:text-amber-400 border border-zinc-700 transition-colors flex items-center gap-2">
                  <i class="pi pi-list"></i>Ver Servicios
                </a>
                <a routerLink="/reservas/nueva" class="px-5 py-2.5 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg shadow-md shadow-amber-500/20 hover:scale-105 transition-transform flex items-center gap-2">
                  <i class="pi pi-bolt"></i>Reservar Turno
                </a>
              </div>
            </div>
          </div>
        </section>
      }

      <!-- CARDS CON PROFUNDIDAD ESPACIAL 3D -->
      <section class="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto pt-4">
        
        <!-- Tarjeta 1: Motor Transaccional -->
        <div class="glass-card rounded-2xl p-6 space-y-4 hover:-translate-y-2 transition-transform duration-300">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xl shadow-inner">
            <i class="pi pi-shield"></i>
          </div>
          <h4 class="text-lg font-display font-bold text-white">Disponibilidad en Tiempo Real</h4>
          <p class="text-xs text-zinc-400 leading-relaxed">
            Motor de concurrencia con aislamiento transaccional estricto. Cero dobles reservas y cálculo de disponibilidad al instante.
          </p>
        </div>

        <!-- Tarjeta 2: Catálogo y Combos -->
        <div class="glass-card rounded-2xl p-6 space-y-4 hover:-translate-y-2 transition-transform duration-300">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xl shadow-inner">
            <i class="pi pi-sliders-h"></i>
          </div>
          <h4 class="text-lg font-display font-bold text-white">Catálogo & Precios Congelados</h4>
          <p class="text-xs text-zinc-400 leading-relaxed">
            Servicios individuales y combos combinados con historial financiero congelado al momento del agendamiento.
          </p>
        </div>

        <!-- Tarjeta 3: Privacidad y Antecedentes -->
        <div class="glass-card rounded-2xl p-6 space-y-4 hover:-translate-y-2 transition-transform duration-300">
          <div class="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-xl shadow-inner">
            <i class="pi pi-lock"></i>
          </div>
          <h4 class="text-lg font-display font-bold text-white">Ficha Técnica & Privacidad</h4>
          <p class="text-xs text-zinc-400 leading-relaxed">
            Tus observaciones de corte y estilos quedan registrados bajo anonimización inter-barberías de estricta protección de datos personales.
          </p>
        </div>

      </section>

    </div>
  `,
})
export class HomeComponent {
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);
}
