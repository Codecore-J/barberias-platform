import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TenantService, BarberiaResumen } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { VincularModalComponent } from './components/vincular-modal/vincular-modal.component';

@Component({
  selector: 'app-barberias',
  standalone: true,
  imports: [CommonModule, RouterLink, VincularModalComponent],
  template: `
    <div class="space-y-12 py-8 perspective-1200 bg-ambient-mesh min-h-screen">
      
      <!-- Título de la sección -->
      <section class="max-w-6xl mx-auto px-4 text-center space-y-4">
        <h2 class="text-4xl sm:text-5xl font-display font-extrabold text-white transform translate-z-12">
          Tus <span class="gold-gradient-text">Barberías</span>
        </h2>
        <p class="text-zinc-400 max-w-2xl mx-auto text-sm sm:text-base">
          Gestiona las barberías a las que tienes acceso. Selecciona una para activar tu sesión y acceder al catálogo y agendamiento.
        </p>
      </section>

      <!-- Estado de Carga -->
      @if (tenantService.isLoading()) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!-- Grid de Barberías (Efecto 3D Tilt) -->
      @if (!tenantService.isLoading() && tenantService.barberiasVinculadas().length > 0) {
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto px-4 transform-style-3d">
          @for (barberia of tenantService.barberiasVinculadas(); track barberia.id) {
            <div class="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden group hover:-translate-y-4 hover:rotate-y-3 hover:rotate-x-3 transition-all duration-500 shadow-[0_15px_40px_rgba(0,0,0,0.5)] transform-style-3d cursor-pointer"
                 [class.border-amber-500]="barberia.id === tenantService.barberiaActivaId()"
                 [class.shadow-[0_0_30px_rgba(212,175,55,0.2)]]="barberia.id === tenantService.barberiaActivaId()">
              
              <!-- Glow de fondo en hover -->
              <div class="absolute -right-20 -bottom-20 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>

              <div class="space-y-6 relative z-10">
                <!-- Header Card -->
                <div class="flex justify-between items-start transform translate-z-12">
                  <div class="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400 text-2xl shadow-inner group-hover:bg-amber-500/10 group-hover:border-amber-500/30 transition-colors">
                    <i class="pi pi-building"></i>
                  </div>
                  
                  @if (barberia.id === tenantService.barberiaActivaId()) {
                    <div class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-2">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      ACTIVA
                    </div>
                  }
                </div>

                <!-- Info -->
                <div class="space-y-2 transform translate-z-24">
                  <h3 class="text-2xl font-display font-bold text-white group-hover:text-amber-300 transition-colors">{{ barberia.nombre }}</h3>
                  <p class="text-xs text-zinc-400 flex items-center gap-2">
                    <i class="pi pi-map-marker text-amber-500"></i>{{ barberia.ubicacion }}
                  </p>
                  <p class="text-xs text-zinc-400 flex items-center gap-2">
                    <i class="pi pi-phone text-amber-500"></i>{{ barberia.telefono }}
                  </p>
                </div>

                <!-- Acciones -->
                <div class="pt-4 flex gap-3 transform translate-z-12">
                  @if (barberia.id !== tenantService.barberiaActivaId()) {
                    <button (click)="seleccionar(barberia.id)"
                            class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-md shadow-amber-500/20 hover:scale-105 transition-transform flex items-center justify-center gap-2">
                      <i class="pi pi-check-circle"></i> Seleccionar
                    </button>
                  } @else {
                    <a [routerLink]="rutaEntrar()"
                            class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800 border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center justify-center gap-2">
                      <i class="pi pi-arrow-right"></i> Entrar
                    </a>
                  }
                </div>
              </div>
            </div>
          }
        </section>
      }

      <!-- Empty State -->
      @if (!tenantService.isLoading() && tenantService.barberiasVinculadas().length === 0) {
        <div class="max-w-xl mx-auto px-4 text-center space-y-6 transform translate-z-12">
          <div class="w-24 h-24 mx-auto rounded-full bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center text-4xl text-zinc-500">
            <i class="pi pi-inbox"></i>
          </div>
          <h3 class="text-xl font-bold text-white">No tienes barberías vinculadas</h3>
          <p class="text-zinc-400 text-sm">
            Para comenzar a agendar turnos o gestionar una barbería, necesitas vincularte a una utilizando un código de acceso o crear la tuya propia.
          </p>
          <div class="flex justify-center gap-4 pt-4">
            <button (click)="showVincularModal.set(true)" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform flex items-center">
              <i class="pi pi-link mr-2"></i>Vincular con Código
            </button>
            @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'SUPER_ADMIN') {
              <button routerLink="/barberias/nueva" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-200 glass-card hover:text-amber-400 transition-colors flex items-center">
                <i class="pi pi-plus mr-2"></i>Crear Barbería
              </button>
            }
          </div>
        </div>
      }

      <!-- Acciones de Grid (Cuando ya hay barberías) -->
      @if (!tenantService.isLoading() && tenantService.barberiasVinculadas().length > 0) {
        <div class="max-w-6xl mx-auto px-4 pt-10 flex flex-wrap justify-center gap-4 transform translate-z-12">
          @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'SUPER_ADMIN') {
            <button routerLink="/barberias/nueva" 
                    class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg shadow-amber-500/20 hover:scale-105 transition-all flex items-center gap-2">
              <i class="pi pi-plus"></i>
              <span>Crear Nueva Barbería</span>
            </button>
          }
          <button (click)="showVincularModal.set(true)" 
                  class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-200 bg-zinc-800/90 border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center gap-2">
            <i class="pi pi-link"></i>
            <span>Vincular con Código</span>
          </button>
        </div>
      }

      <!-- Modal de Vinculación -->
      @if (showVincularModal()) {
        <app-vincular-modal (close)="showVincularModal.set(false)"></app-vincular-modal>
      }

    </div>
  `
})
export class BarberiasComponent implements OnInit {
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);
  
  showVincularModal = signal(false);

  ngOnInit() {
    this.tenantService.cargarBarberias().subscribe();
  }

  userRole(): string {
    const roles = this.authService.authState().user?.roles;
    if (!roles || roles.length === 0) return 'CLIENTE';
    if (roles.includes('SUPER_ADMIN') || roles.includes('ADMINISTRADOR')) return 'SUPER_ADMIN';
    if (roles.includes('ADMIN_BARBERIA')) return 'ADMIN_BARBERIA';
    if (roles.includes('BARBERO')) return 'BARBERO';
    return 'CLIENTE';
  }

  rutaEntrar(): string {
    const role = this.userRole();
    if (role === 'SUPER_ADMIN' || role === 'ADMIN_BARBERIA' || role === 'BARBERO') {
      return '/admin/agenda';
    }
    return '/';
  }

  seleccionar(id: string) {
    this.tenantService.seleccionarBarberia(id).subscribe({
      next: () => {
        const role = this.userRole();
        if (role === 'SUPER_ADMIN' || role === 'ADMIN_BARBERIA' || role === 'BARBERO') {
          this.authService['router'].navigate(['/admin/agenda']);
        } else {
          this.authService['router'].navigate(['/']);
        }
      }
    });
  }
}
