import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, type FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TenantService } from '../../core/services/tenant.service';
import type {
  ActualizarBarberiaRequest,
  BarberiaResumen,
} from '../../core/services/tenant.service';
import { mensajeDeError } from '../../core/utils/error-message';
import { AuthService } from '../../auth/auth.service';
import { MiEstadoService } from '../../core/services/mi-estado.service';
import type { MiEstado } from '../../core/services/mi-estado.service';
import { rolEfectivo, type RolSesion } from '../../core/utils/rol';
import { VincularModalComponent } from './components/vincular-modal/vincular-modal.component';
import { SedeCardComponent } from './components/sede-card/sede-card.component';

import { ModalShellComponent } from '../../shared/ui/modal-shell/modal-shell.component';

/**
 * Lo que `UpdateBarberiaDto` acepta, ya normalizado a texto: el teléfono exige
 * `passwordActual` (D27). Se guardan como instantánea para comparar y enviar
 * únicamente lo que cambió.
 */
interface CamposEditables {
  telefono: string;
  ubicacion: string;
  descripcion: string;
  logoUrl: string;
}

@Component({
  selector: 'app-barberias',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    VincularModalComponent,
    SedeCardComponent,
    ModalShellComponent,
  ],
  template: `
    <div class="space-y-12 py-8 perspective-1200 bg-ambient-mesh min-h-screen">
      
      <!-- Título de la sección -->
      <section class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div class="space-y-2">
          <!--
            D05 · el ADMINISTRADOR global no está vinculado a ninguna sede: este
            hub no es su «estado vacío», es su consola de supervisión. El
            distintivo lo dice sin que tenga que adivinarlo por el contenido.
          -->
          @if (esSuperadmin()) {
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-semibold uppercase tracking-wider">
              <i class="pi pi-shield text-[10px]"></i>
              <span>Acceso Global · Superadmin</span>
            </span>
          }

          <h2 class="text-4xl sm:text-5xl font-display font-extrabold text-white transform translate-z-12">
            @if (esSuperadmin()) {
              Sedes de la <span class="gold-gradient-text">Plataforma</span>
            } @else {
              Tus <span class="gold-gradient-text">Barberías</span>
            }
          </h2>

          <p class="text-zinc-400 max-w-2xl text-sm sm:text-base">
            @if (esSuperadmin()) {
              Supervisa y audita cualquier sede del sistema. Elige una para abrir su panel
              administrativo: no necesitas estar vinculado a ella.
            } @else {
              Gestiona las barberías a las que tienes acceso. Selecciona una para activar tu sesión y acceder al catálogo y agendamiento.
            }
          </p>
        </div>

        @if (userRole() === 'ADMIN_BARBERIA' || userRole() === 'ADMINISTRADOR') {
          <button routerLink="/barberias/nueva"
                  class="px-5 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-lg shadow-amber-500/20 hover:scale-105 transition-all flex items-center justify-center gap-2 shrink-0">
            <i class="pi pi-plus"></i>
            <span>Crear Nueva Barbería</span>
          </button>
        }
      </section>

      <!--
        Buscador de sedes (D05). Aparece cuando la lista es larga —el caso del
        superadmin, que ve todas las sedes de la plataforma— y filtra EN LOCAL:
        el universo ya llegó del backend, así que teclear no dispara peticiones.
      -->
      @if (esSuperadmin() || tenantService.barberiasVinculadas().length > 3) {
        <section class="max-w-6xl mx-auto px-4">
          <div class="relative">
            <i class="pi pi-search absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"></i>
            <input
              type="search"
              [value]="filtro()"
              (input)="filtro.set($any($event.target).value)"
              placeholder="Buscar sede por nombre, ubicación o código…"
              aria-label="Buscar sede"
              class="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-11 pr-10 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
            >
            @if (filtro()) {
              <button
                (click)="filtro.set('')"
                aria-label="Limpiar búsqueda"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-amber-400 transition-colors">
                <i class="pi pi-times"></i>
              </button>
            }
          </div>
          <p class="mt-2 text-[11px] text-zinc-500" aria-live="polite">
            {{ barberiasVisibles().length }} de {{ tenantService.barberiasVinculadas().length }} sedes
          </p>
        </section>
      }

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
      @if (!tenantService.isLoading() && barberiasVisibles().length > 0) {
        <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto px-4 transform-style-3d">
          @for (barberia of barberiasVisibles(); track barberia.id) {
            <app-sede-card
              [barberia]="barberia"
              [estado]="estadoDe(barberia.id)"
              [esActiva]="barberia.id === tenantService.barberiaActivaId()"
              [verInvitacion]="puedeVerCodigoInvitacion()"
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
              <!--
                E3-13 · edición directa de la sede. Solo para quien puede
                ejercerla: el ADMINISTRADOR global (cualquier sede) y el
                ADMIN_BARBERIA responsable de ESA sede —el PATCH responde 403
                a cualquier otro, así que el botón no se ofrece en falso—.
              -->
              @if (puedeEditar(barberia)) {
                <button (click)="abrirEdicion(barberia)"
                        class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-300 bg-white/5 border border-white/10 hover:border-amber-500/50 hover:text-amber-300 transition-colors flex items-center justify-center gap-2">
                  <i class="pi pi-pencil"></i>
                  <span>Editar datos de la sede</span>
                </button>
              }

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
          @if (esSuperadmin()) {
            <h3 class="text-xl font-bold text-white">No hay sedes activas en la plataforma</h3>
            <p class="text-zinc-400 text-sm">
              No existe ninguna sede en estado activo que supervisar. Cuando una se registre
              aparecerá aquí automáticamente.
            </p>
          } @else {
            <h3 class="text-xl font-bold text-white">No tienes barberías vinculadas</h3>
            <p class="text-zinc-400 text-sm">
              Para comenzar a agendar turnos o gestionar una barbería, necesitas vincularte a una barbería activa con un código de acceso, o crear la tuya propia.
            </p>
          }
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
          @if (userRole() === 'CLIENTE') {
            <button (click)="showVincularModal.set(true)" 
                    class="px-6 py-3 rounded-xl font-bold text-sm text-zinc-200 bg-zinc-800/90 border border-zinc-700 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center gap-2">
              <i class="pi pi-link"></i>
              <span>Vincular con Código</span>
            </button>
          }
        </div>
      }

      <!-- Búsqueda sin coincidencias: la lista NO está vacía, el filtro sí -->
      @if (
        !tenantService.isLoading() &&
        tenantService.barberiasVinculadas().length > 0 &&
        barberiasVisibles().length === 0
      ) {
        <div class="max-w-xl mx-auto px-4 text-center space-y-3">
          <i class="pi pi-search text-2xl text-zinc-600"></i>
          <p class="text-sm text-zinc-300">Ninguna sede coincide con «{{ filtro() }}».</p>
          <button (click)="filtro.set('')" class="text-xs font-semibold text-amber-400 hover:text-amber-300">
            Limpiar búsqueda
          </button>
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
        <app-modal-shell
          [visible]="true"
          titulo="Desvincularme"
          [subtitulo]="objetivo.nombre"
          icono="pi pi-sign-out"
          tono="peligro"
          [cerrarBloqueado]="miEstado.isLoading()"
          (cerrar)="cerrarDesvinculacion()">
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

          <div modal-footer class="flex gap-3 pt-2 border-t border-zinc-800">
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
        </app-modal-shell>
      }

      <!--
        Edición de la sede (E3-13 · D26/D27).

        El nombre NO está en el formulario: cambiarlo exige una solicitud
        aprobada por la plataforma y el backend responde 422
        NOMBRE_REQUIERE_SOLICITUD. El teléfono sí, pero pide la contraseña
        actual en cuanto se separa del original: es la regla de D27 y se avisa
        ANTES de enviar, no después del 422.
      -->
      @if (sedeEnEdicion(); as sede) {
        <app-modal-shell
          [visible]="true"
          titulo="Editar sede"
          [subtitulo]="sede.nombre"
          icono="pi pi-pencil"
          [cerrarBloqueado]="guardandoSede()"
          (cerrar)="cerrarEdicion()">
          <form [formGroup]="formEdicion" (ngSubmit)="guardarEdicion()" class="space-y-4" novalidate>
            <div>
              <label for="sede-editar-ubicacion" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                Ubicación
              </label>
              <input
                id="sede-editar-ubicacion"
                formControlName="ubicacion"
                type="text"
                maxlength="500"
                [disabled]="guardandoSede()"
                [attr.aria-invalid]="campoEditInvalido('ubicacion')"
                class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                placeholder="Calle, número, sector"
              >
              @if (campoEditInvalido('ubicacion')) {
                <p role="alert" class="text-[11px] text-red-400 mt-1">
                  La ubicación es obligatoria y admite hasta 500 caracteres.
                </p>
              }
            </div>

            <div>
              <label for="sede-editar-descripcion" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                Descripción
              </label>
              <textarea
                id="sede-editar-descripcion"
                formControlName="descripcion"
                rows="3"
                maxlength="1000"
                [disabled]="guardandoSede()"
                class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors resize-none"
                placeholder="Ambiente, servicios destacados, referencias…"
              ></textarea>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="sede-editar-telefono" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Teléfono
                </label>
                <input
                  id="sede-editar-telefono"
                  formControlName="telefono"
                  type="tel"
                  inputmode="numeric"
                  autocomplete="tel-national"
                  maxlength="10"
                  (input)="onTelefonoEdicion($event)"
                  [disabled]="guardandoSede()"
                  [attr.aria-invalid]="campoEditInvalido('telefono')"
                  class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                  placeholder="8090000000"
                >
                @if (campoEditInvalido('telefono')) {
                  <p role="alert" class="text-[11px] text-red-400 mt-1">
                    El teléfono debe tener exactamente 10 dígitos.
                  </p>
                }
              </div>

              <div>
                <label for="sede-editar-logo" class="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Logo (URL)
                </label>
                <input
                  id="sede-editar-logo"
                  formControlName="logoUrl"
                  type="url"
                  maxlength="500"
                  [disabled]="guardandoSede()"
                  class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                  placeholder="https://…"
                >
              </div>
            </div>

            @if (cambiaTelefono()) {
              <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2">
                <p class="text-[11px] text-amber-200/90 leading-snug">
                  El teléfono es el dato de contacto de la sede: cambiarlo exige tu
                  contraseña actual (D27).
                </p>
                <label for="sede-editar-password" class="block text-xs font-semibold text-zinc-400">
                  Tu contraseña actual
                </label>
                <input
                  id="sede-editar-password"
                  formControlName="passwordActual"
                  type="password"
                  autocomplete="current-password"
                  maxlength="100"
                  [disabled]="guardandoSede()"
                  [attr.aria-invalid]="campoEditInvalido('passwordActual')"
                  class="w-full bg-zinc-950 border border-zinc-700/60 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-60 transition-colors"
                  placeholder="••••••••"
                >
                @if (campoEditInvalido('passwordActual')) {
                  <p role="alert" class="text-[11px] text-red-400 mt-1">
                    Escribe tu contraseña actual para cambiar el teléfono.
                  </p>
                }
              </div>
            }

            @if (errorEdicion()) {
              <div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                <i class="pi pi-exclamation-triangle mt-0.5"></i>
                <span>{{ errorEdicion() }}</span>
              </div>
            }

            <div class="flex gap-3 pt-2 border-t border-zinc-800">
              <button
                type="button"
                (click)="cerrarEdicion()"
                [disabled]="guardandoSede()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-zinc-400 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors">
                Cancelar
              </button>
              <button
                type="submit"
                [disabled]="guardandoSede() || !hayCambios()"
                class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-zinc-950 gold-gradient-bg disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                <i class="pi" [ngClass]="guardandoSede() ? 'pi-spin pi-spinner' : 'pi-check'"></i>
                <span>{{ guardandoSede() ? 'Guardando…' : 'Guardar cambios' }}</span>
              </button>
            </div>
          </form>
        </app-modal-shell>
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

  /** Término del buscador de sedes (D05). Local: no dispara peticiones. */
  readonly filtro = signal('');

  /** D05 · el rol global se identifica para el distintivo y los textos. */
  readonly esSuperadmin = computed(() => this.userRole() === 'ADMINISTRADOR');

  /**
   * Sedes que pinta el hub: todas, o las que coinciden con la búsqueda.
   *
   * Se compara sin acentos ni mayúsculas sobre nombre, ubicación y código de
   * acceso: son los tres datos con los que el superadmin identifica una sede
   * cuando tiene decenas en el listado.
   */
  readonly barberiasVisibles = computed(() => {
    const termino = this.normalizar(this.filtro());
    const sedes = this.tenantService.barberiasVinculadas();

    if (!termino) {
      return sedes;
    }

    return sedes.filter((sede) =>
      [sede.nombre, sede.ubicacion, sede.codigoAcceso]
        .filter(Boolean)
        .some((campo) => this.normalizar(String(campo)).includes(termino)),
    );
  });

  private normalizar(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /** Sede pendiente de confirmar su salida; `null` cuando no hay modal. */
  readonly barberiaADesvincular = signal<BarberiaResumen | null>(null);
  readonly mensajeExito = signal('');

  ngOnInit() {
    // D05 · el superadmin no hereda sede: entra al hub a elegir cuál audita.
    this.tenantService
      .cargarBarberias({ autoSeleccionar: !this.esSuperadmin() })
      .subscribe(() => {
        this.cargarEstados();
      });
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

    this.miEstado.cargarEstados().subscribe();
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
        this.tenantService
          .cargarBarberias({ autoSeleccionar: !this.esSuperadmin() })
          .subscribe(() => {
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

  // ── E3-13 · edición de la sede ──────────────────────────────────────────

  private readonly fb = inject(FormBuilder);

  /** Sede que se está editando; `null` cuando el modal está cerrado. */
  readonly sedeEnEdicion = signal<BarberiaResumen | null>(null);
  readonly guardandoSede = signal(false);
  readonly errorEdicion = signal<string | null>(null);

  /**
   * Valores de partida. `hayCambios()` y `cambiaTelefono()` comparan contra
   * esto: sin la referencia no se puede saber qué se tocó, y mandar todos los
   * campos haría pasar por cambio de teléfono un simple retoque de descripción
   * —y dispararía la exigencia de contraseña de D27 sin motivo—.
   */
  private readonly originalEdicion = signal<CamposEditables | null>(null);

  readonly formEdicion: FormGroup = this.fb.group({
    // Mismo contrato que `UpdateBarberiaDto`: 10 dígitos exactos, sin formato.
    telefono: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    ubicacion: ['', [Validators.required, Validators.maxLength(500)]],
    descripcion: ['', [Validators.maxLength(1000)]],
    logoUrl: ['', [Validators.maxLength(500)]],
    // Solo se exige cuando el teléfono cambia; el validador se activa al abrir.
    passwordActual: [''],
  });

  /**
   * Solo edita quien puede: el ADMINISTRADOR global sobre cualquier sede —el
   * backend resuelve su alcance— y el ADMIN_BARBERIA que es responsable de ESA
   * sede. Ofrecer el botón al resto sería prometer un 403.
   */
  puedeEditar(barberia: BarberiaResumen): boolean {
    const rol = this.userRole();
    if (rol === 'ADMINISTRADOR') return true;
    if (rol !== 'ADMIN_BARBERIA') return false;
    return barberia.responsableId === this.authService.authState().user?.id;
  }

  abrirEdicion(barberia: BarberiaResumen): void {
    const original: CamposEditables = {
      telefono: barberia.telefono ?? '',
      ubicacion: barberia.ubicacion ?? '',
      descripcion: barberia.descripcion ?? '',
      logoUrl: barberia.logoUrl ?? '',
    };

    this.originalEdicion.set(original);
    this.errorEdicion.set(null);
    this.formEdicion.reset({ ...original, passwordActual: '' });
    this.sedeEnEdicion.set(barberia);
  }

  cerrarEdicion(): void {
    if (this.guardandoSede()) return;
    this.sedeEnEdicion.set(null);
    this.errorEdicion.set(null);
  }

  /** Invalido y ya tocado: mismo criterio que el alta de sede. */
  campoEditInvalido(nombre: string): boolean {
    const control = this.formEdicion.get(nombre);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  /** Solo dígitos y máximo 10: el backend rechaza cualquier otra cosa con 400. */
  onTelefonoEdicion(event: Event): void {
    const input = event.target as HTMLInputElement;
    const limpio = input.value.replace(/\D/g, '').slice(0, 10);
    if (input.value !== limpio) {
      input.value = limpio;
      this.formEdicion.get('telefono')?.setValue(limpio);
    }
  }

  /** D27 · el teléfono se separó del original: hay que pedir la contraseña. */
  cambiaTelefono(): boolean {
    const original = this.originalEdicion();
    return !!original && this.formEdicion.get('telefono')?.value !== original.telefono;
  }

  /**
   * El botón de guardar solo se habilita si hay algo que mandar. Se comparan los
   * cuatro campos editables; el nombre y el estado ni se envían.
   */
  hayCambios(): boolean {
    const original = this.originalEdicion();
    if (!original) return false;

    const actual = this.formEdicion.getRawValue();
    return (
      (actual.telefono ?? '') !== original.telefono ||
      (actual.ubicacion ?? '').trim() !== original.ubicacion.trim() ||
      (actual.descripcion ?? '').trim() !== original.descripcion.trim() ||
      (actual.logoUrl ?? '').trim() !== original.logoUrl.trim()
    );
  }

  /**
   * `PATCH /shops/:shopId` con SOLO los campos tocados: el `ValidationPipe` usa
   * `forbidNonWhitelisted`, y mandar `nombre`/`estado` —aunque no hayan
   * cambiado— devuelve el 422 de negocio en vez de editar el resto.
   *
   * La contraseña viaja únicamente cuando cambia el teléfono (D27); si falta, el
   * backend responde 422 `PASSWORD_REQUERIDA` y su mensaje se pinta tal cual.
   */
  guardarEdicion(): void {
    const sede = this.sedeEnEdicion();
    const original = this.originalEdicion();
    if (!sede || !original || this.guardandoSede()) return;

    // Si cambia el teléfono, la contraseña pasa a ser obligatoria.
    const password = this.formEdicion.get('passwordActual');
    if (this.cambiaTelefono()) {
      password?.setValidators([Validators.required]);
    } else {
      password?.clearValidators();
    }
    password?.updateValueAndValidity({ emitEvent: false });

    if (this.formEdicion.invalid) {
      this.formEdicion.markAllAsTouched();
      return;
    }

    const valores = this.formEdicion.getRawValue();
    const dto: ActualizarBarberiaRequest = {};

    if ((valores.ubicacion ?? '').trim() !== original.ubicacion.trim()) {
      dto.ubicacion = (valores.ubicacion ?? '').trim();
    }
    if ((valores.descripcion ?? '').trim() !== original.descripcion.trim()) {
      dto.descripcion = (valores.descripcion ?? '').trim();
    }
    if ((valores.logoUrl ?? '').trim() !== original.logoUrl.trim()) {
      dto.logoUrl = (valores.logoUrl ?? '').trim();
    }
    if ((valores.telefono ?? '') !== original.telefono) {
      dto.telefono = valores.telefono;
      dto.passwordActual = valores.passwordActual;
    }

    if (Object.keys(dto).length === 0) {
      this.errorEdicion.set('No has cambiado ningún dato todavía.');
      return;
    }

    this.guardandoSede.set(true);
    this.errorEdicion.set(null);

    this.tenantService.actualizarBarberia(sede.id, dto).subscribe({
      next: (actualizada) => {
        this.guardandoSede.set(false);
        this.sedeEnEdicion.set(null);
        this.originalEdicion.set(null);
        // La tarjeta lee la invitación de su propio objeto de sede, y el
        // `tap` de `actualizarBarberia` ya refresca la lista: no hay caché
        // aparte que invalidar.
        this.avisar(`Sede actualizada: ${actualizada?.nombre ?? sede.nombre}.`);
      },
      error: (err) => {
        // El modal se queda abierto con lo escrito: el mensaje de negocio (422
        // de teléfono o de contraseña) dice qué corregir.
        this.guardandoSede.set(false);
        this.errorEdicion.set(mensajeDeError(err, 'No se pudo actualizar la sede'));
      },
    });
  }

  /**
   * Rol efectivo de la sesión, derivado del helper único (`rolEfectivo`).
   *
   * Antes esta copia local devolvía `CLIENTE` ante una cuenta sin roles, y con
   * eso el hub le ofrecía el modal de vinculación de cliente y disparaba
   * `/mi-estado/membresias` (403) para una cuenta que no tiene ningún rol.
   */
  readonly userRole = computed<RolSesion>(() =>
    rolEfectivo(this.authService.authState().user?.roles),
  );

  puedeVerCodigoInvitacion(): boolean {
    const role = this.userRole();
    return role === 'ADMIN_BARBERIA' || role === 'ADMINISTRADOR';
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
