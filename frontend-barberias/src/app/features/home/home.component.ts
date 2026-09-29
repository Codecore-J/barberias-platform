import { Component, HostListener, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="relative min-h-[150vh] perspective-1200 overflow-hidden bg-ambient-mesh">
      
      <!-- Fondo dinámico con paralaje 3D -->
      <div class="fixed inset-0 pointer-events-none z-0 transform-style-3d transition-transform duration-75 ease-out"
           [style.transform]="'translateZ(-500px) scale(1.5) translateY(' + (scrollY() * 0.5) + 'px)'">
        <div class="absolute inset-0 bg-obsidian opacity-40"></div>
        <!-- Elementos flotantes de fondo -->
        <div class="absolute top-1/4 left-1/4 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl"></div>
        <div class="absolute bottom-1/3 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl"></div>
      </div>

      <!-- Contenedor principal con efecto de inclinación del mouse -->
      <div class="relative z-10 space-y-24 py-12 transform-style-3d transition-transform duration-300 ease-out"
           [style.transform]="'rotateX(' + (mouseY() * -5) + 'deg) rotateY(' + (mouseX() * 5) + 'deg)'">
        
        <!-- HERO 3D SECTION -->
        <section class="relative text-center max-w-4xl mx-auto pt-16 pb-8 space-y-6 transform-style-3d"
                 [style.transform]="'translateZ(' + (scrollY() * 0.2) + 'px)'">
          
          <!-- Badge Superior Flotante -->
          <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:scale-110 hover:shadow-[0_0_30px_rgba(212,175,55,0.4)] transition-all duration-500 transform translate-z-12">
            <i class="pi pi-crown text-amber-400"></i>
            <span>Plataforma de Barberías Premium</span>
          </div>

          <!-- Título Principal -->
          <h1 class="text-5xl sm:text-7xl lg:text-8xl font-display font-extrabold tracking-tight text-white leading-[1.1] transform translate-z-24 drop-shadow-2xl">
            La Experiencia Suprema en
            <span class="block gold-gradient-text drop-shadow-[0_0_30px_rgba(212,175,55,0.3)]">Corte, Cuidado y Estilo</span>
          </h1>

          <!-- Subtítulo -->
          <p class="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed transform translate-z-12">
            Agenda tus turnos en tiempo real con precisión milimétrica, consulta el catálogo de servicios de tu barbería favorita y accede a tu ficha técnica personalizada.
          </p>

          <!-- Botones de Acción Rápida 3D -->
          <div class="flex flex-wrap items-center justify-center gap-6 pt-8 transform translate-z-24">
            <a routerLink="/reservas/nueva"
               class="px-8 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_40px_rgba(212,175,55,0.3)] hover:shadow-[0_20px_60px_rgba(212,175,55,0.5)] hover:-translate-y-2 hover:scale-105 transition-all duration-500 flex items-center gap-2.5">
              <i class="pi pi-calendar-plus text-base"></i>
              <span>Agendar Cita Ahora</span>
            </a>

            <a routerLink="/barberias"
               class="px-7 py-4 rounded-xl font-semibold text-sm text-zinc-200 glass-card hover:text-amber-400 hover:border-amber-500/50 hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(0,0,0,0.8)] transition-all duration-500 flex items-center gap-2.5">
              <i class="pi pi-building text-amber-400"></i>
              <span>Explorar Barberías</span>
            </a>
          </div>
        </section>

        <!-- BARBERÍA ACTIVA HIGHLIGHT BANNER -->
        @if (tenantService.barberiaActiva(); as barberia) {
          <section class="max-w-4xl mx-auto transform-style-3d transition-all duration-700"
                   [style.transform]="'translateZ(' + (scrollY() > 100 ? 50 : 0) + 'px)'"
                   [style.opacity]="scrollY() > 50 ? 1 : 0.8">
            <div class="glass-panel rounded-3xl p-8 border border-amber-500/40 shadow-[0_20px_60px_rgba(0,0,0,0.8)] relative overflow-hidden group hover:scale-[1.02] transition-transform duration-500">
              <div class="absolute -right-20 -bottom-20 w-64 h-64 bg-amber-500/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
              
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
                <div class="space-y-2 transform translate-z-12">
                  <div class="flex items-center gap-2">
                    <span class="inline-block w-3 h-3 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></span>
                    <span class="text-xs font-bold text-amber-400 uppercase tracking-widest letter-spacing-2">Barbería Activa Conectada</span>
                  </div>
                  <h3 class="text-3xl font-display font-bold text-white drop-shadow-md">{{ barberia.nombre }}</h3>
                  <p class="text-sm text-zinc-400 flex items-center gap-2 font-medium">
                    <i class="pi pi-map-marker text-amber-500"></i>{{ barberia.ubicacion }}
                    <span class="text-zinc-600">&bull;</span>
                    <i class="pi pi-phone text-amber-500"></i>{{ barberia.telefono }}
                  </p>
                </div>

                <div class="flex items-center gap-4 transform translate-z-24">
                  <a routerLink="/catalogo" class="px-5 py-3 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 hover:text-amber-400 border border-zinc-600/50 hover:border-amber-500/50 transition-all duration-300 flex items-center gap-2 hover:-translate-y-1 shadow-lg">
                    <i class="pi pi-list"></i>Ver Servicios
                  </a>
                  <a routerLink="/reservas/nueva" class="px-6 py-3 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-[0_10px_20px_rgba(212,175,55,0.2)] hover:shadow-[0_15px_30px_rgba(212,175,55,0.4)] hover:-translate-y-1 hover:scale-105 transition-all duration-300 flex items-center gap-2">
                    <i class="pi pi-bolt"></i>Reservar Turno
                  </a>
                </div>
              </div>
            </div>
          </section>
        }

        <!-- CARDS CON PROFUNDIDAD ESPACIAL 3D -->
        <section class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto pt-10 transform-style-3d">
          
          <!-- Tarjeta 1 -->
          <div class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d"
               [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
            <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-shield"></i>
            </div>
            <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Disponibilidad en Tiempo Real</h4>
            <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
              Motor de concurrencia con aislamiento transaccional estricto. Cero dobles reservas y cálculo de disponibilidad al instante.
            </p>
          </div>

          <!-- Tarjeta 2 -->
          <div class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-6 hover:scale-105 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d"
               [style.transform]="'translateZ(' + (scrollY() > 200 ? 60 : 0) + 'px)'">
            <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-sliders-h"></i>
            </div>
            <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Catálogo & Precios Congelados</h4>
            <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
              Servicios individuales y combos combinados con historial financiero congelado al momento del agendamiento.
            </p>
          </div>

          <!-- Tarjeta 3 -->
          <div class="glass-card rounded-3xl p-8 space-y-5 hover:-translate-y-4 hover:-rotate-y-6 hover:rotate-x-6 transition-all duration-500 group shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d"
               [style.transform]="'translateZ(' + (scrollY() > 200 ? 30 : 0) + 'px)'">
            <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/20 group-hover:scale-110 transition-all duration-500 transform translate-z-12">
              <i class="pi pi-lock"></i>
            </div>
            <h4 class="text-xl font-display font-bold text-white transform translate-z-12 group-hover:text-amber-300 transition-colors">Ficha Técnica & Privacidad</h4>
            <p class="text-sm text-zinc-400 leading-relaxed transform translate-z-8">
              Tus observaciones de corte y estilos quedan registrados bajo anonimización inter-barberías de estricta protección de datos personales.
            </p>
          </div>

        </section>
      </div>
    </div>
  `,
})
export class HomeComponent {
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);

  // Señales reactivas para el motor 3D
  scrollY = signal<number>(0);
  mouseX = signal<number>(0);
  mouseY = signal<number>(0);

  @HostListener('window:scroll', ['$event'])
  onScroll() {
    this.scrollY.set(window.scrollY);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    // Normalizar coordenadas del mouse de -1 a 1 para rotación 3D
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    this.mouseX.set(x);
    this.mouseY.set(y);
  }
}
