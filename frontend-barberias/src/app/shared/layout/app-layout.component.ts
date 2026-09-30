import { Component, inject, OnInit, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { TenantService } from '../../core/services/tenant.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="relative min-h-screen bg-[#09090b] text-zinc-100 overflow-x-hidden perspective-1200 bg-ambient-mesh">
      <!-- Decoración de Fondo 3D Atmosférico -->
      <div class="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <!-- Luces ambientales de profundidad -->
        <div class="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-b from-amber-500/15 via-amber-600/5 to-transparent rounded-full blur-3xl"></div>
        <div class="absolute top-1/3 -left-32 w-80 h-80 bg-amber-500/8 rounded-full blur-3xl"></div>
        <div class="absolute bottom-10 -right-32 w-96 h-96 bg-amber-400/8 rounded-full blur-3xl"></div>
        
        <!-- Malla de cuadrícula tridimensional sutil -->
        <div class="absolute inset-0 opacity-[0.025]"
             style="background-image: linear-gradient(#d4af37 1px, transparent 1px), linear-gradient(90deg, #d4af37 1px, transparent 1px); background-size: 50px 50px;">
        </div>
      </div>

      <!-- NAVBAR FLOTANTE GLASSMORPHISM -->
      <header class="fixed top-4 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto transition-all duration-300">
        <nav class="glass-panel rounded-2xl px-4 py-3 sm:px-6 flex items-center justify-between border border-amber-500/20 shadow-2xl backdrop-blur-xl">
          
          <!-- BRAND / LOGO -->
          <a routerLink="/" class="flex items-center gap-3 group focus:outline-none">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform duration-300">
              <div class="w-full h-full bg-[#0d0d11] rounded-[10px] flex items-center justify-center">
                <i class="pi pi-sparkles text-amber-400 text-lg group-hover:rotate-12 transition-transform duration-300"></i>
              </div>
            </div>
            <div class="flex flex-col">
              <span class="font-display font-extrabold text-lg tracking-wider gold-gradient-text uppercase">
                Imperial Barbers
              </span>
              <span class="text-[10px] text-zinc-400 font-medium tracking-widest uppercase -mt-1">
                Luxury & Precision
              </span>
            </div>
          </a>

          <!-- BADGE DE BARBERÍA ACTIVA (CENTRO) -->
          <div class="hidden md:flex items-center">
            @if (tenantService.barberiaActiva(); as barberia) {
              <div class="flex items-center gap-2 bg-zinc-900/80 border border-amber-500/30 rounded-full px-3.5 py-1.5 shadow-inner">
                <span class="relative flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span class="text-xs font-semibold text-zinc-200 truncate max-w-[160px] lg:max-w-[220px]">
                  {{ barberia.nombre }}
                </span>
                <a routerLink="/barberias" class="ml-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium underline-offset-2 hover:underline">
                  Cambiar
                </a>
              </div>
            } @else {
              <a routerLink="/barberias" class="flex items-center gap-2 bg-amber-950/40 border border-amber-500/40 rounded-full px-3.5 py-1.5 hover:bg-amber-900/50 transition-colors">
                <i class="pi pi-exclamation-circle text-amber-400 text-xs"></i>
                <span class="text-xs font-medium text-amber-200">
                  Seleccionar Barbería
                </span>
              </a>
            }
          </div>

          <!-- ENLACES DE NAVEGACIÓN DESKTOP -->
          <div class="hidden lg:flex items-center gap-1 xl:gap-2">
            <a routerLink="/barberias" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
               class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-white/5 border border-transparent transition-all">
              <i class="pi pi-building mr-1.5 text-xs text-amber-400/80"></i>Barberías
            </a>
            
            @if (userRole() === 'ADMIN' || userRole() === 'SUPER ADMIN') {
              <a routerLink="/admin/servicios" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
                 class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-white/5 border border-transparent transition-all">
                <i class="pi pi-cog mr-1.5 text-xs text-amber-400/80"></i>Servicios
              </a>
            }

            @if (userRole() === 'BARBERO' || userRole() === 'ADMIN' || userRole() === 'SUPER ADMIN') {
              <a routerLink="/admin/agenda" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
                 class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-white/5 border border-transparent transition-all">
                <i class="pi pi-calendar mr-1.5 text-xs text-amber-400/80"></i>Mi Agenda
              </a>
            } @else {
              <a routerLink="/catalogo" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
                 class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-white/5 border border-transparent transition-all">
                <i class="pi pi-list mr-1.5 text-xs text-amber-400/80"></i>Catálogo
              </a>
            }

            <a routerLink="/reservas/nueva" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
               class="px-3.5 py-1.5 rounded-lg text-xs font-bold text-amber-300 bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/40 hover:from-amber-500/30 hover:to-amber-600/30 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
              <i class="pi pi-calendar-plus mr-1.5 text-xs"></i>Agendar Cita
            </a>
            <a routerLink="/reservas/mis-reservas" routerLinkActive="text-amber-400 bg-amber-500/10 border-amber-500/30"
               class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-white/5 border border-transparent transition-all">
              <i class="pi pi-history mr-1.5 text-xs text-amber-400/80"></i>Mis Citas
            </a>
          </div>

          <!-- ACCIONES DERECHA: NOTIFICACIONES & PERFIL -->
          <div class="flex items-center gap-2 sm:gap-3">
            
            <!-- CAMPANA DE NOTIFICACIONES -->
            <div class="relative">
              <button (click)="toggleNotifications()" class="relative w-9 h-9 rounded-xl bg-zinc-900/80 border border-zinc-700/60 hover:border-amber-500/40 flex items-center justify-center text-zinc-300 hover:text-amber-400 transition-colors focus:outline-none">
                <i class="pi pi-bell text-sm"></i>
                @if (notificationService.noLeidasCount() > 0) {
                  <span class="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-[#09090b] text-[10px] font-extrabold rounded-full flex items-center justify-center animate-pulse">
                    {{ notificationService.noLeidasCount() }}
                  </span>
                }
              </button>

              <!-- Dropdown Notificaciones -->
              @if (notificationsDropdownOpen()) {
                <div class="absolute right-0 mt-3 w-80 sm:w-96 glass-panel rounded-2xl p-4 border border-amber-500/30 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div class="flex items-center justify-between pb-3 border-b border-zinc-800">
                    <span class="font-display font-semibold text-sm text-zinc-200">Notificaciones</span>
                    <button (click)="marcarTodasComoLeidas()" class="text-[11px] text-amber-400 hover:text-amber-300 font-medium cursor-pointer">
                      Marcar todo leído
                    </button>
                  </div>
                  <div class="mt-3 max-h-64 overflow-y-auto space-y-2">
                    @if (notificationService.notificaciones().length === 0) {
                      <div class="py-6 text-center text-xs text-zinc-500">
                        <i class="pi pi-inbox text-2xl text-zinc-600 mb-2 block"></i>
                        No tienes notificaciones pendientes
                      </div>
                    } @else {
                      @for (item of notificationService.notificaciones(); track item.id) {
                        <div (click)="marcarComoLeida(item)" 
                             class="p-2.5 rounded-xl border transition-all text-xs cursor-pointer"
                             [ngClass]="item.leido ? 'bg-zinc-900/40 border-zinc-800/50 opacity-70' : 'bg-zinc-900/80 border-amber-500/30 hover:bg-zinc-800'">
                          <p class="font-semibold" [ngClass]="item.leido ? 'text-zinc-400' : 'text-amber-300'">
                            {{ item.titulo }}
                            @if (!item.leido) {
                              <span class="inline-block w-2 h-2 bg-amber-500 rounded-full ml-1"></span>
                            }
                          </p>
                          <p class="text-[11px] mt-0.5" [ngClass]="item.leido ? 'text-zinc-500' : 'text-zinc-300'">{{ item.mensaje }}</p>
                        </div>
                      }
                    }
                  </div>
                </div>
              }
            </div>

            <!-- PERFIL DE USUARIO / CERRAR SESIÓN -->
            <div class="relative">
              <button (click)="toggleProfileMenu()" class="flex items-center gap-2 p-1.5 rounded-xl bg-zinc-900/80 border border-zinc-700/60 hover:border-amber-500/40 transition-all focus:outline-none">
                <div class="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-600 to-amber-300 flex items-center justify-center text-zinc-950 font-bold text-xs shadow-md">
                  {{ userInitials() }}
                </div>
                <div class="hidden sm:flex flex-col text-left pr-1">
                  <span class="text-xs font-semibold text-zinc-200 truncate max-w-[100px] leading-tight">
                    {{ userName() }}
                  </span>
                  <span class="text-[10px] text-amber-400/90 font-medium">
                    {{ userRole() }}
                  </span>
                </div>
                <i class="pi pi-chevron-down text-[10px] text-zinc-400 hidden sm:block"></i>
              </button>

              <!-- Dropdown Perfil -->
              @if (profileDropdownOpen()) {
                <div class="absolute right-0 mt-3 w-56 glass-panel rounded-2xl p-2 border border-amber-500/30 shadow-2xl z-50">
                  <div class="px-3 py-2 border-b border-zinc-800 text-xs text-zinc-400">
                    Conectado como <strong class="text-zinc-200">{{ userEmail() }}</strong>
                  </div>
                  <div class="p-1 space-y-1">
                    <a routerLink="/barberias" (click)="profileDropdownOpen.set(false)" class="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-amber-400 hover:bg-zinc-800/60 rounded-xl transition-colors">
                      <i class="pi pi-building text-amber-400 text-xs"></i>Gestionar Barberías
                    </a>
                    <button (click)="onLogout()" class="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-xl transition-colors text-left">
                      <i class="pi pi-sign-out text-rose-400 text-xs"></i>Cerrar Sesión
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- BOTÓN HAMBURGUESA MOBILE -->
            <button (click)="toggleMobileMenu()" class="lg:hidden w-9 h-9 rounded-xl bg-zinc-900/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300 hover:text-amber-400 focus:outline-none">
              <i [class]="mobileMenuOpen() ? 'pi pi-times' : 'pi pi-bars'" class="text-sm"></i>
            </button>

          </div>
        </nav>

        <!-- MENÚ DESPLEGABLE MOBILE -->
        @if (mobileMenuOpen()) {
          <div class="lg:hidden mt-2 glass-panel rounded-2xl p-4 border border-amber-500/30 shadow-2xl z-50 animate-in fade-in duration-200">
            <!-- Barbería activa en mobile -->
            <div class="pb-3 border-b border-zinc-800 mb-3">
              @if (tenantService.barberiaActiva(); as barberia) {
                <div class="flex items-center justify-between text-xs">
                  <span class="text-zinc-400">Barbería activa:</span>
                  <span class="font-bold text-amber-300">{{ barberia.nombre }}</span>
                </div>
              }
            </div>
            
            <div class="flex flex-col gap-1.5">
              <a routerLink="/barberias" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-2">
                <i class="pi pi-building text-amber-400"></i>Barberías
              </a>
              
              @if (userRole() === 'ADMIN' || userRole() === 'SUPER ADMIN') {
                <a routerLink="/admin/servicios" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-2">
                  <i class="pi pi-cog text-amber-400"></i>Gestión de Servicios
                </a>
              }

              @if (userRole() === 'BARBERO' || userRole() === 'ADMIN' || userRole() === 'SUPER ADMIN') {
                <a routerLink="/admin/agenda" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-2">
                  <i class="pi pi-calendar text-amber-400"></i>Mi Agenda
                </a>
              } @else {
                <a routerLink="/catalogo" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-2">
                  <i class="pi pi-list text-amber-400"></i>Catálogo de Servicios
                </a>
              }

              <a routerLink="/reservas/nueva" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                <i class="pi pi-calendar-plus text-amber-400"></i>Agendar Cita
              </a>
              <a routerLink="/reservas/mis-reservas" (click)="mobileMenuOpen.set(false)" class="px-3 py-2 rounded-xl text-sm font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-2">
                <i class="pi pi-history text-amber-400"></i>Mis Citas
              </a>
            </div>
          </div>
        }
      </header>

      <!-- CONTENEDOR PRINCIPAL CON PROFUNDIDAD ESPACIAL 3D -->
      <main class="relative z-10 pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto transform-style-3d">
        <router-outlet></router-outlet>
      </main>

      <!-- FOOTER DE LUJO -->
      <footer class="relative z-10 border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md py-8 px-4 text-center text-xs text-zinc-500">
        <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
            <span class="text-zinc-400">Plataforma Multi-Tenant Activa &bull; NestJS + Angular 19</span>
          </div>
          <p class="text-zinc-400">
            &copy; 2026 <span class="gold-gradient-text font-bold">IMPERIAL BARBERS PLATFORM</span>. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class AppLayoutComponent implements OnInit {
  protected readonly authService = inject(AuthService);
  protected readonly tenantService = inject(TenantService);
  protected readonly notificationService = inject(NotificationService);

  readonly mobileMenuOpen = signal<boolean>(false);
  readonly profileDropdownOpen = signal<boolean>(false);
  readonly notificationsDropdownOpen = signal<boolean>(false);

  ngOnInit() {
    this.tenantService.cargarBarberias().subscribe();
    this.notificationService.cargarNotificaciones().subscribe();
  }

  toggleMobileMenu() {
    this.mobileMenuOpen.update((v) => !v);
  }

  toggleProfileMenu() {
    this.profileDropdownOpen.update((v) => !v);
    if (this.profileDropdownOpen()) {
      this.notificationsDropdownOpen.set(false);
    }
  }

  toggleNotifications() {
    this.notificationsDropdownOpen.update((v) => !v);
    if (this.notificationsDropdownOpen()) {
      this.profileDropdownOpen.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.relative')) {
      this.profileDropdownOpen.set(false);
      this.notificationsDropdownOpen.set(false);
    }
  }

  userName(): string {
    const user = this.authService.authState().user;
    return user?.nombreCompleto?.split(' ')[0] ?? 'Usuario';
  }

  userEmail(): string {
    return this.authService.authState().user?.correo ?? '';
  }

  userRole(): string {
    const roles = this.authService.authState().user?.roles;
    if (!roles || roles.length === 0) return 'CLIENTE';
    if (roles.includes('SUPER_ADMIN')) return 'SUPER ADMIN';
    if (roles.includes('ADMIN_BARBERIA') || roles.includes('ADMINISTRADOR')) return 'ADMIN';
    if (roles.includes('BARBERO')) return 'BARBERO';
    return 'CLIENTE';
  }

  userInitials(): string {
    const name = this.authService.authState().user?.nombreCompleto ?? 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  marcarComoLeida(item: any) {
    if (item.leido) return; // Ya está leída
    this.notificationService.marcarComoLeida(item.id).subscribe();
  }

  marcarTodasComoLeidas() {
    this.notificationService.marcarTodasComoLeidas().subscribe();
  }

  onLogout() {
    this.tenantService.limpiarTenant();
    this.authService.logout();
  }
}
