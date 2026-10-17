import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';
import type { BarberiaResumen } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { MiEstadoService } from '../../core/services/mi-estado.service';
import type { MiEstado } from '../../core/services/mi-estado.service';
import { VincularModalComponent } from './components/vincular-modal/vincular-modal.component';
import { SedeCardComponent } from './components/sede-card/sede-card.component';

@Component({
  selector: 'app-barberias',
  standalone: true,
  imports: [CommonModule, RouterLink, VincularModalComponent, SedeCardComponent],
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

      <!-- Aviso tras cerrar un vínculo (E3-12/3) -->
      @if (mensajeExito()) {
        <div class="max-w-6xl mx-auto px-4">
          <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
            <i class="pi pi-check-circle"></i> {{ mensajeExito() }}
          </div>
        </div>
      }

      <!-- Error de la desvinculación (contrato D40: 422 con reservas en curso, 409 ya cerrado) -->
      @if (miEstado.error()) {
        <div class="max-w-6xl mx-auto px-4">
          <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <i class="pi pi-exclamation-triangle"></i> {{ miEstado.error() }}
          </div>
        </div>
      }

      <!--
        Error de la selección de sede (hallazgo 2): el backend es quien
        autoriza el cambio —403 de un vínculo pendiente, 404 de una sede sin
        vínculo o caída de red—, así que el fallo deja aquí su mensaje y la
        sede que había sigue siendo la activa.
      -->
      @if (tenantService.error()) {
        <div class="max-w-6xl mx-auto px-4">
          <div class="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <i class="pi pi-exclamation-triangle"></i> {{ tenantService.error() }}
          </div>
        </div>
      }

      <!-- Estado de Carga -->
      @if (tenantService.isLoading()) {
        <div class="flex justify-center items-center py-20">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      <!--
        Grid de Barberías (Efecto 3D Tilt).
        H72: la tarjeta vive en SedeCardComponent porque el home del CLIENTE
        pinta la MISMA tarjeta con la lista de GET /mi-estado/barberias.
      -->
      @if (!tenantService.isLoading() && tenantService.barberiasVinculadas().length > 0) {
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto px-4 transform-style-3d">
          @for (barberia of tenantService.barberiasVinculadas(); track barberia.id) {
            <app-sede-card
              [barberia]="barberia"
              [estado]="estadoDe(barberia.id)"
              [esActiva]="barberia.id === tenantService.barberiaActivaId()"
            >
              <!-- Acciones -->
              <div class="flex gap-3">
                @if (barberia.id === tenantService.barberiaActivaId()) {
                  <a [routerLink]="rutaEntrar()"
                          class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-200 bg-zinc-800 border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center justify-center gap-2">
                    <i class="pi pi-arrow-right"></i> Entrar
                  </a>
                } @else if (puedeSeleccionar(barberia)) {
                  <button (click)="seleccionar(barberia.id)"
                          class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-950 gold-gradient-bg shadow-md shadow-amber-500/20 hover:scale-105 transition-transform flex items-center justify-center gap-2">
                    <i class="pi pi-check-circle"></i> Seleccionar
                  </button>
                } @else {
                  <!--
                    PENDIENTE_APROBACION (D10): la sede no opera todavía para este
                    cliente —/seleccionar responde 403—, así que no se ofrece el
                    botón y se explica por qué.
                  -->
                  <span class="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold text-amber-300/80 bg-amber-500/10 border border-amber-500/30 flex items-center justify-center gap-2 cursor-default">
                    <i class="pi pi-clock"></i> Esperando aprobación
                  </span>
                }
              </div>

              <!--
                El botón de salida (E3-12/3 · H72). Solo aparece donde el cliente
                TIENE un vínculo consultado —si el backend responde NO_VINCULADO
                no hay nada que cerrar— y nunca sobre una fila ya cerrada (el
                estado se relee tras cada cambio).
              -->
              @if (puedeDesvincularse(barberia.id)) {
                <button (click)="abrirDesvinculacion(barberia)"
                        class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 transition-colors flex items-center justify-center gap-2">
                  <i class="pi pi-sign-out"></i>
                  <span>Desvincularme de esta Barbería</span>
                </button>
              }
            </app-sede-card>
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
            @if (userRole() === 'CLIENTE') {
              <button (click)="showVincularModal.set(true)" class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg hover:scale-105 transition-transform flex items-center">
                <i class="pi pi-link mr-2"></i>Vincular con Código
              </button>
            }
            @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
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
          @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
            <button routerLink="/barberias/nueva" 
                    class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg shadow-amber-500/20 hover:scale-105 transition-all flex items-center gap-2">
              <i class="pi pi-plus"></i>
              <span>Crear Nueva Barbería</span>
            </button>
          }
          @if (userRole() === 'CLIENTE') {
            <button (click)="showVincularModal.set(true)" 
                    class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-200 bg-zinc-800/90 border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center gap-2">
              <i class="pi pi-link"></i>
              <span>Vincular con Código</span>
            </button>
          }
        </div>
      }

      <!-- Modal de Vinculación -->
      @if (showVincularModal()) {
        <app-vincular-modal (close)="showVincularModal.set(false)"></app-vincular-modal>
      }

      <!--
        Confirmación de la salida (E3-12/3). El cierre es reversible solo
        volviendo a introducir el código de acceso (D21), así que se avisa antes
        de hacerlo y con las consecuencias exactas de D20: el historial y el
        contador de inasistencias NO se borran.
      -->
      @if (barberiaADesvincular(); as objetivo) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div class="bg-zinc-900 border border-rose-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6 space-y-5">
              <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <i class="pi pi-sign-out text-lg"></i>
                  </div>
                  <div>
                    <h3 class="text-lg font-bold text-white">Desvincularme</h3>
                    <p class="text-xs text-zinc-400">{{ objetivo.nombre }}</p>
                  </div>
                </div>
                <button (click)="cerrarDesvinculacion()" class="text-zinc-500 hover:text-white transition-colors">
                  <i class="pi pi-times text-xl"></i>
                </button>
              </div>

              <div class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-2">
                <p>
                  Vas a cerrar tu vínculo con
                  <span class="font-semibold">{{ objetivo.nombre }}</span>: dejarás de ver su catálogo
                  y no podrás reservar en esa sede.
                </p>
                <p class="text-rose-200/80">
                  Tu historial y tu contador de inasistencias se conservan (D20/D21). Si vuelves a
                  introducir su código de acceso, recuperas la misma vinculación.
                </p>
                @if (estadoDe(objetivo.id)?.estaRestringido) {
                  <p class="text-rose-200 font-semibold">
                    Esta sede te tiene restringido: desvincularte NO levanta esa restricción.
                  </p>
                }
              </div>

              @if (miEstado.error()) {
                <div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                  <i class="pi pi-exclamation-triangle mt-0.5"></i>
                  <span>{{ miEstado.error() }}</span>
                </div>
              }

              <div class="flex gap-3 pt-2 border-t border-zinc-800">
                <button (click)="cerrarDesvinculacion()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 transition-colors">
                  Cancelar
                </button>
                <button (click)="confirmarDesvinculacion()" [disabled]="miEstado.isLoading()"
                        class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <i class="pi" [ngClass]="miEstado.isLoading() ? 'pi-spin pi-spinner' : 'pi-user-minus'"></i>
                  <span>Sí, desvincularme</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      }

    </div>
  `
})
export class BarberiasComponent implements OnInit {
  protected readonly tenantService = inject(TenantService);
  protected readonly authService = inject(AuthService);
  protected readonly miEstado = inject(MiEstadoService);
  private readonly router = inject(Router);

  showVincularModal = signal(false);

  /** Sede pendiente de confirmar su salida; `null` cuando no hay modal. */
  readonly barberiaADesvincular = signal<BarberiaResumen | null>(null);
  readonly mensajeExito = signal('');

  ngOnInit() {
    this.tenantService.cargarBarberias().subscribe(() => this.cargarEstados());
  }

  /**
   * Mi estado (H54) solo lo sirve el backend al CLIENTE y solo donde hay fila en
   * `cliente_barberias`: una sede sin vínculo responde 403 NO_VINCULADO y el
   * servicio lo traduce a `null`, así que aquí no se pinta nada. Desde H72 la
   * lista del cliente ya trae SOLO sus sedes, así que el contador se pide una vez
   * por sede y todas responden.
   */
  private cargarEstados(): void {
    if (this.userRole() !== 'CLIENTE') {
      return;
    }

    for (const barberia of this.tenantService.barberiasVinculadas()) {
      this.miEstado.cargarEstado(barberia.id).subscribe();
    }
  }

  estadoDe(barberiaId: string): MiEstado | null {
    return this.miEstado.estados()[barberiaId] ?? null;
  }

  /** Solo se puede salir de un vínculo que existe y que sigue vivo. */
  puedeDesvincularse(barberiaId: string): boolean {
    const estado = this.estadoDe(barberiaId);
    return (
      this.userRole() === 'CLIENTE' &&
      !!estado &&
      estado.estadoVinculacion !== 'DESVINCULADO'
    );
  }

  abrirDesvinculacion(barberia: BarberiaResumen): void {
    this.miEstado.error.set(null);
    this.barberiaADesvincular.set(barberia);
  }

  cerrarDesvinculacion(): void {
    this.barberiaADesvincular.set(null);
  }

  /**
   * El cierre lo decide el backend: aquí solo se muestra lo que responda. Si la
   * sede tiene reservas en curso responde 422 y el modal se queda abierto con el
   * mensaje del contrato D40, que es lo que el cliente necesita leer.
   *
   * H74 · la purga va en el `next` y ANTES de la recarga: el vínculo ya no existe
   * en el backend, así que mantener la sede en la sesión mientras viaja la
   * petición deja al usuario operando sobre una sede fantasma (cabecera y
   * `x-barberia-id` incluidos). Si la desvinculada era además la ÚLTIMA sede, no
   * hay contexto de barbería que sostener y se vuelve al dashboard raíz.
   */
  confirmarDesvinculacion(): void {
    const objetivo = this.barberiaADesvincular();
    if (!objetivo) {
      return;
    }

    this.miEstado.desvincular(objetivo.id).subscribe({
      next: (resultado) => {
        this.barberiaADesvincular.set(null);
        this.tenantService.purgarBarberia(objetivo.id);
        this.avisar(
          `Te desvinculaste de ${resultado.barberiaNombre}. Te quedan ${resultado.vinculacionesVigentes} barberías vinculadas.`,
        );
        this.tenantService.cargarBarberias().subscribe(() => {
          this.cargarEstados();
          if (this.tenantService.barberiasVinculadas().length === 0) {
            // Purga absoluta: sin sedes no queda nada de un vínculo cerrado en la
            // sesión (ni el estado por sede que alimentaba las tarjetas) y se
            // vuelve al dashboard raíz, fuera del contexto de barbería.
            this.miEstado.limpiar();
            this.router.navigate(['/']);
          }
        });
      },
    });
  }

  private avisar(texto: string): void {
    this.mensajeExito.set(texto);
    setTimeout(() => this.mensajeExito.set(''), 6000);
  }

  userRole(): string {
    const roles = this.authService.authState().user?.roles;
    if (!roles || roles.length === 0) return 'CLIENTE';
    if (roles.includes('ADMINISTRADOR')) return 'ADMINISTRADOR';
    if (roles.includes('ADMIN_BARBERIA')) return 'ADMIN_BARBERIA';
    if (roles.includes('BARBERO')) return 'BARBERO';
    return 'CLIENTE';
  }

  /**
   * Solo se puede fijar como activa una sede donde el vínculo OPERA: una
   * `PENDIENTE_APROBACION` responde 403 en `/seleccionar` (D10). El staff no
   * trae `estadoVinculacion` en su listado y sigue viendo «Seleccionar».
   */
  puedeSeleccionar(barberia: BarberiaResumen): boolean {
    return barberia.estadoVinculacion !== 'PENDIENTE_APROBACION';
  }

  rutaEntrar(): string {
    const role = this.userRole();
    if (role === 'ADMINISTRADOR' || role === 'ADMIN_BARBERIA' || role === 'BARBERO') {
      return '/admin/agenda';
    }
    return '/';
  }

  seleccionar(id: string) {
    this.tenantService.seleccionarBarberia(id).subscribe({
      next: () => {
        const role = this.userRole();
        if (role === 'ADMINISTRADOR' || role === 'ADMIN_BARBERIA' || role === 'BARBERO') {
          this.router.navigate(['/admin/agenda']);
        } else {
          this.router.navigate(['/']);
        }
      },
      // Hallazgo 2: si el backend rechaza la selección no se navega y la sede
      // anterior sigue siendo la activa; el mensaje ya queda en
      // `tenantService.error()` y lo muestra el banner de arriba.
      error: () => undefined,
    });
  }
}
