import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, model, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ETIQUETA_ROL, RolSesion, rolEfectivo } from '../../../core/utils/rol.js';

/** Una entrada del menú lateral. `ruta` es la MISMA que declara `app.routes.ts`. */
interface ItemNav {
  ruta: string;
  etiqueta: string;
  icono: string;
}

interface GrupoNav {
  titulo: string;
  items: ItemNav[];
}

/**
 * T-14 · shell del panel de administración: sidebar lateral colapsable.
 *
 * Sustituye al navbar flotante SOLO para el staff (ADMINISTRADOR,
 * ADMIN_BARBERIA y BARBERO). No declara rutas ni guardas: cada entrada apunta a
 * la ruta que ya existe con su `canActivate` intacto, y la lista se compone del
 * rol efectivo de la sesión para que nadie vea un módulo que el guard le va a
 * negar. El cliente conserva su navbar en `app-layout`.
 *
 * Medidas: 240px expandida, 72px colapsada (solo iconos + `title`), drawer con
 * backdrop por debajo de 1024px. El colapso se recuerda en `localStorage`.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- BARRA SUPERIOR MÓVIL -->
    <header
      class="lg:hidden fixed inset-x-0 top-0 z-[70] flex h-16 items-center justify-between gap-3 border-b border-amber-500/20 bg-[#0b0b0e]/95 px-4 backdrop-blur-xl"
    >
      <button
        type="button"
        (click)="toggleDrawer()"
        class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700/60 bg-zinc-900/80 text-zinc-300 transition-colors hover:text-amber-400 focus:outline-none"
        aria-label="Abrir menú de navegación"
        [attr.aria-expanded]="drawerAbierto()"
      >
        <i class="pi pi-bars text-sm"></i>
      </button>

      <a routerLink="/" class="flex min-w-0 flex-1 items-center gap-2">
        <span
          class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-700 text-zinc-950"
        >
          <i class="pi pi-sparkles text-xs"></i>
        </span>
        <span class="min-w-0">
          <span class="block truncate font-display text-xs font-bold uppercase tracking-wider text-zinc-100">
            Imperial Barbers
          </span>
          <span class="block truncate text-[10px] text-zinc-500">{{ nombreSede() }}</span>
        </span>
      </a>

      <span
        class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-amber-600 to-amber-300 text-xs font-bold text-zinc-950"
        [title]="nombreUsuario()"
      >
        {{ iniciales() }}
      </span>
    </header>

    <!-- FONDO OSCURECIDO DEL DRAWER -->
    @if (drawerAbierto()) {
      <div
        class="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm lg:hidden"
        (click)="cerrarDrawer()"
        aria-hidden="true"
      ></div>
    }

    <!-- SIDEBAR -->
    <aside
      class="app-sidebar"
      [class.colapsado]="compacto()"
      [class.abierta-movil]="drawerAbierto()"
      aria-label="Navegación del panel"
    >
      <!-- Encabezado: marca + colapsar -->
      <div class="relative flex items-center gap-2 border-b border-zinc-800/70 px-3 py-4">
        <a routerLink="/" class="flex min-w-0 flex-1 items-center gap-2.5" aria-label="Ir al inicio">
          <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-lg shadow-amber-500/20"
          >
            <span class="grid h-full w-full place-items-center rounded-[10px] bg-[#0d0d11]">
              <i class="pi pi-sparkles text-sm text-amber-400"></i>
            </span>
          </span>
          @if (!compacto()) {
            <span class="min-w-0">
              <span class="block truncate font-display text-[13px] font-extrabold uppercase tracking-[0.1em] gold-gradient-text">
                Imperial Barbers
              </span>
              <span class="block truncate text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                Panel de administración
              </span>
            </span>
          }
        </a>

        <!--
          El control de colapso va montado en el borde del panel (no en la
          fila de la marca): así el nombre completo de la barbería cabe a 240px
          y sigue siendo accesible con la barra colapsada.
        -->
        <button
          type="button"
          (click)="toggleColapsado()"
          class="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-amber-500/30 bg-[#121215] text-zinc-400 shadow-lg transition-colors hover:border-amber-500/60 hover:text-amber-400 focus:outline-none lg:flex"
          [attr.aria-label]="compacto() ? 'Expandir la barra lateral' : 'Colapsar la barra lateral'"
          [attr.aria-expanded]="!compacto()"
          [title]="compacto() ? 'Expandir' : 'Colapsar'"
        >
          <i class="text-[9px]" [class]="compacto() ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'"></i>
        </button>

        <button
          type="button"
          (click)="cerrarDrawer()"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700/60 text-zinc-400 transition-colors hover:text-amber-400 focus:outline-none lg:hidden"
          aria-label="Cerrar menú"
        >
          <i class="pi pi-times text-xs"></i>
        </button>
      </div>

      <!-- Contexto de sede (tenant) -->
      <div class="border-b border-zinc-800/70 px-3 py-3">
        @if (compacto()) {
          <a
            routerLink="/barberias"
            class="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-400 transition-colors hover:bg-amber-500/20"
            [title]="'Sede activa: ' + nombreSede() + ' · cambiar'"
            aria-label="Cambiar de sede"
          >
            <i class="pi pi-shop text-xs"></i>
          </a>
        } @else {
          <div class="rounded-xl border border-amber-500/25 bg-zinc-900/70 px-2.5 py-2">
            <div class="flex items-center gap-1.5">
              <span class="relative flex h-2 w-2">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sede activa</span>
            </div>
            <p class="mt-0.5 truncate text-xs font-semibold text-zinc-100">{{ nombreSede() }}</p>
            <a
              routerLink="/barberias"
              (click)="cerrarDrawer()"
              class="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 transition-colors hover:text-amber-300"
            >
              <i class="pi pi-arrow-right-arrow-left text-[9px]"></i>
              {{ haySedeActiva() ? 'Cambiar sede' : 'Elegir sede' }}
            </a>
          </div>
        }
      </div>

      <!-- Navegación principal -->
      <nav class="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Módulos">
        @for (grupo of grupos(); track grupo.titulo) {
          <div>
            @if (!compacto()) {
              <p class="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {{ grupo.titulo }}
              </p>
            }
            <ul class="space-y-1">
              @for (item of grupo.items; track item.ruta) {
                <li>
                  <a
                    [routerLink]="item.ruta"
                    routerLinkActive="activo"
                    [routerLinkActiveOptions]="{ exact: true }"
                    (click)="cerrarDrawer()"
                    class="nav-item"
                    [class.justify-center]="compacto()"
                    [attr.aria-label]="item.etiqueta"
                    [title]="compacto() ? item.etiqueta : ''"
                  >
                    <i [class]="item.icono"></i>
                    @if (!compacto()) {
                      <span class="min-w-0 flex-1 truncate">{{ item.etiqueta }}</span>
                    }
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </nav>

      <!-- Pie: notificaciones, gobernanza de sede y perfil -->
      <div class="space-y-2 border-t border-zinc-800/70 px-2 py-3">
        @if (!compacto()) {
          <p class="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {{ tituloAjustes() }}
          </p>
        }

        <a
          [routerLink]="configuracion().ruta"
          routerLinkActive="activo"
          [routerLinkActiveOptions]="{ exact: true }"
          (click)="cerrarDrawer()"
          class="nav-item nav-config"
          [class.justify-center]="compacto()"
          [attr.aria-label]="configuracion().etiqueta"
          [title]="compacto() ? configuracion().etiqueta : ''"
        >
          <i class="pi pi-sliders-h"></i>
          @if (!compacto()) {
            <span class="min-w-0 flex-1 truncate">{{ configuracion().etiqueta }}</span>
            <i class="pi pi-chevron-right text-[9px] text-zinc-500"></i>
          }
        </a>

        <button
          type="button"
          data-notif
          (click)="toggleNotificaciones()"
          class="nav-item w-full"
          [class.justify-center]="compacto()"
          [attr.aria-expanded]="notificacionesAbierto()"
          aria-haspopup="true"
          [attr.aria-label]="'Notificaciones' + (notificacionService.noLeidasCount() > 0 ? ': ' + notificacionService.noLeidasCount() + ' sin leer' : '')"
          [title]="compacto() ? 'Notificaciones' : ''"
        >
          <span class="relative">
            <i class="pi pi-bell"></i>
            @if (notificacionService.noLeidasCount() > 0) {
              <span
                class="absolute -right-1.5 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-500 px-0.5 text-[8px] font-extrabold text-zinc-950"
              >
                {{ notificacionService.noLeidasCount() }}
              </span>
            }
          </span>
          @if (!compacto()) {
            <span class="min-w-0 flex-1 text-left">Notificaciones</span>
            @if (notificacionService.noLeidasCount() > 0) {
              <span class="text-[10px] font-bold text-amber-400">{{ notificacionService.noLeidasCount() }}</span>
            }
          }
        </button>

        <!-- Tarjeta del usuario autenticado -->
        <div class="rounded-xl border border-zinc-800 bg-zinc-900/80 p-2">
          @if (compacto()) {
            <div class="flex flex-col items-center gap-2">
              <span
                class="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-tr from-amber-600 to-amber-300 text-[11px] font-bold text-zinc-950"
                [title]="nombreUsuario() + ' · ' + chipsRol().join(' + ')"
              >
                {{ iniciales() }}
              </span>
              <button
                type="button"
                (click)="salir()"
                class="grid h-7 w-7 place-items-center rounded-lg text-rose-400 transition-colors hover:bg-rose-950/40 hover:text-rose-300 focus:outline-none"
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
              >
                <i class="pi pi-sign-out text-xs"></i>
              </button>
            </div>
          } @else {
            <div class="flex items-center gap-2">
              <span
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-tr from-amber-600 to-amber-300 text-[11px] font-bold text-zinc-950"
              >
                {{ iniciales() }}
              </span>
              <span class="min-w-0">
                <span class="block truncate text-xs font-semibold leading-tight text-zinc-100">
                  {{ nombreUsuario() }}
                </span>
                <span class="block truncate text-[10px] text-zinc-500">{{ correoUsuario() }}</span>
              </span>
            </div>

            @if (chipsRol().length > 0) {
              <div class="mt-1.5 flex flex-wrap gap-1">
                @for (chip of chipsRol(); track chip) {
                  <span
                    class="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
                  >
                    {{ chip }}
                  </span>
                }
              </div>
            }

            <button
              type="button"
              (click)="salir()"
              class="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium text-rose-400 transition-colors hover:bg-rose-950/30 hover:text-rose-300 focus:outline-none"
            >
              <i class="pi pi-sign-out text-[10px]"></i>
              Cerrar sesión
            </button>
          }
        </div>
      </div>
    </aside>

    <!-- PANEL DE NOTIFICACIONES (una sola instancia, anclada al sidebar) -->
    @if (notificacionesAbierto()) {
      <div
        data-notif
        class="glass-panel fixed right-4 top-20 z-[80] w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-3 lg:bottom-40 lg:left-3 lg:right-auto lg:top-auto lg:w-72"
      >
        <div class="flex items-center justify-between border-b border-zinc-800 pb-2">
          <span class="font-display text-xs font-semibold text-zinc-200">Notificaciones</span>
          <button
            type="button"
            (click)="marcarTodasComoLeidas()"
            class="text-[10px] font-medium text-amber-400 hover:text-amber-300"
          >
            Marcar todo leído
          </button>
        </div>
        <div class="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
          @if (notificacionService.notificaciones().length === 0) {
            <div class="py-5 text-center text-[11px] text-zinc-500">
              <i class="pi pi-inbox mb-1.5 block text-xl text-zinc-600"></i>
              No tienes notificaciones pendientes
            </div>
          } @else {
            @for (item of notificacionService.notificaciones(); track item.id) {
              <button
                type="button"
                (click)="marcarComoLeida(item)"
                class="w-full rounded-lg border p-2 text-left transition-colors"
                [ngClass]="
                  item.leido
                    ? 'border-zinc-800/60 bg-zinc-900/40 opacity-70'
                    : 'border-amber-500/30 bg-zinc-900/80 hover:bg-zinc-800'
                "
              >
                <span class="block text-[11px] font-semibold" [ngClass]="item.leido ? 'text-zinc-400' : 'text-amber-300'">
                  {{ item.titulo }}
                </span>
                <span class="mt-0.5 block text-[10px]" [ngClass]="item.leido ? 'text-zinc-500' : 'text-zinc-300'">
                  {{ item.mensaje }}
                </span>
              </button>
            }
          }
        </div>
      </div>
    }
  `,
})
export class AdminShellComponent {
  protected readonly authService = inject(AuthService);
  protected readonly tenantService = inject(TenantService);
  protected readonly notificacionService = inject(NotificationService);

  /** Colapso compartido con `app-layout`, que ajusta el margen del contenido. */
  readonly colapsado = model(false);
  readonly cerrarSesion = output<void>();
  readonly drawerAbierto = signal(false);
  readonly notificacionesAbierto = signal(false);

  /** En móvil el drawer siempre se abre expandido, aunque el escritorio esté colapsado. */
  readonly compacto = computed(() => this.colapsado() && !this.drawerAbierto());

  readonly rol = computed<RolSesion>(() => rolEfectivo(this.authService.authState().user?.roles));

  readonly esAdministrador = computed(() => this.rol() === 'ADMINISTRADOR');

  readonly haySedeActiva = computed(() => !!this.tenantService.barberiaActiva());

  readonly nombreSede = computed(
    () => this.tenantService.barberiaActiva()?.nombre ?? 'Sin sede seleccionada',
  );

  readonly nombreUsuario = computed(
    () => this.authService.authState().user?.nombreCompleto ?? 'Usuario',
  );

  readonly correoUsuario = computed(() => this.authService.authState().user?.correo ?? '');

  /**
   * Insignias de rol de la cuenta. Se recorren TODOS los roles del token para
   * que una cuenta dual (ADMIN_BARBERIA + BARBERO) muestre las dos, sin repetir
   * la etiqueta cuando el backend devuelve el mismo rol dos veces.
   */
  readonly chipsRol = computed<string[]>(() => {
    const roles = this.authService.authState().user?.roles ?? [];
    const etiquetas = roles.map((rol) => ETIQUETA_ROL[rol as RolSesion] ?? rol);
    return [...new Set(etiquetas)];
  });

  /**
   * Operación diaria. Cada ruta es la de `app.routes.ts`, con su guard intacto;
   * aquí solo se decide qué se pinta para el rol efectivo.
   */
  readonly grupos = computed<GrupoNav[]>(() => {
    const rol = this.rol();

    if (rol === 'ADMINISTRADOR') {
      return [
        {
          titulo: 'Plataforma',
          items: [
            { ruta: '/barberias', etiqueta: 'Barberías', icono: 'pi pi-building' },
            { ruta: '/admin/usuarios', etiqueta: 'Usuarios', icono: 'pi pi-id-card' },
            { ruta: '/admin/vinculaciones', etiqueta: 'Vinculaciones', icono: 'pi pi-user-plus' },
            {
              ruta: '/admin/antecedentes/solicitudes',
              etiqueta: 'Solicitudes de antecedentes',
              icono: 'pi pi-shield',
            },
          ],
        },
        {
          titulo: 'Operación de sede',
          items: [
            { ruta: '/admin/agenda', etiqueta: 'Agenda de sede', icono: 'pi pi-calendar' },
            { ruta: '/admin/servicios', etiqueta: 'Servicios', icono: 'pi pi-list' },
            {
              ruta: '/admin/categorias',
              etiqueta: 'Categorías',
              icono: 'pi pi-tags',
            },
            { ruta: '/admin/analiticas', etiqueta: 'Analíticas', icono: 'pi pi-chart-bar' },
          ],
        },
        {
          titulo: 'Gobernanza de sede',
          items: [
            { ruta: '/admin/propuestas-horario', etiqueta: 'Propuestas de horario', icono: 'pi pi-inbox' },
            { ruta: '/admin/tickets', etiqueta: 'Pagos', icono: 'pi pi-receipt' },
            { ruta: '/admin/solicitudes-cambio', etiqueta: 'Solicitudes de cambio', icono: 'pi pi-send' },
            { ruta: '/admin/clientes-restringidos', etiqueta: 'Clientes restringidos', icono: 'pi pi-shield' },
            { ruta: '/admin/antecedentes', etiqueta: 'Antecedentes', icono: 'pi pi-flag' },
          ],
        },
      ];
    }

    if (rol === 'ADMIN_BARBERIA') {
      return [
        {
          titulo: 'Operación diaria',
          items: [
            { ruta: '/admin/agenda', etiqueta: 'Agenda', icono: 'pi pi-calendar' },
            { ruta: '/admin/servicios', etiqueta: 'Servicios', icono: 'pi pi-list' },
            { ruta: '/admin/categorias', etiqueta: 'Categorías', icono: 'pi pi-tags' },
            { ruta: '/admin/personal', etiqueta: 'Equipo', icono: 'pi pi-users' },
            { ruta: '/admin/analiticas', etiqueta: 'Analíticas', icono: 'pi pi-chart-bar' },
          ],
        },
        {
          titulo: 'Gobernanza de sede',
          items: [
            { ruta: '/admin/propuestas-horario', etiqueta: 'Propuestas de horario', icono: 'pi pi-inbox' },
            { ruta: '/admin/tickets', etiqueta: 'Pagos', icono: 'pi pi-receipt' },
            { ruta: '/admin/solicitudes-cambio', etiqueta: 'Solicitudes de cambio', icono: 'pi pi-send' },
            { ruta: '/admin/clientes-restringidos', etiqueta: 'Clientes restringidos', icono: 'pi pi-shield' },
            { ruta: '/admin/antecedentes', etiqueta: 'Antecedentes', icono: 'pi pi-flag' },
          ],
        },
      ];
    }

    if (rol === 'BARBERO') {
      return [
        {
          titulo: 'Mi operación',
          items: [
            { ruta: '/admin/agenda', etiqueta: 'Mi agenda', icono: 'pi pi-calendar' },
            { ruta: '/barbero/servicios', etiqueta: 'Mis servicios', icono: 'pi pi-briefcase' },
            { ruta: '/admin/servicios', etiqueta: 'Catálogo de sede', icono: 'pi pi-list' },
            { ruta: '/catalogo', etiqueta: 'Catálogo', icono: 'pi pi-shop' },
            { ruta: '/barbero/antecedentes', etiqueta: 'Antecedentes', icono: 'pi pi-flag' },
          ],
        },
      ];
    }

    return [];
  });

  /**
   * T-14 · el ancla de gobernanza del pie.
   *
   * Antes, «Configuración» convivía con el catálogo y podía terminar apuntando
   * al hub de sedes (`/barberias/nueva`) en vez de a los ajustes de la sede
   * activa. Ahora es un enlace único y explícito: horarios de la sede para los
   * administradores, plantilla horaria propia para el barbero.
   */
  /** Evita repetir el título del grupo de gobernanza (el pie es otra sección). */
  readonly tituloAjustes = computed(() =>
    this.rol() === 'BARBERO' ? 'Ajustes personales' : 'Ajustes de la sede',
  );

  readonly configuracion = computed<ItemNav>(() =>
    this.rol() === 'BARBERO'
      ? { ruta: '/barbero/horarios', etiqueta: 'Configuración', icono: 'pi pi-sliders-h' }
      : { ruta: '/admin/horarios', etiqueta: 'Configuración de sede', icono: 'pi pi-sliders-h' },
  );

  readonly iniciales = computed(() => {
    const nombre = this.nombreUsuario().trim();
    const partes = nombre.split(/\s+/);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return nombre.slice(0, 2).toUpperCase() || 'U';
  });

  toggleColapsado(): void {
    this.colapsado.update((valor) => !valor);
    localStorage.setItem('sidebar_admin_colapsado', String(this.colapsado()));
  }

  toggleDrawer(): void {
    this.drawerAbierto.update((abierto) => !abierto);
    this.notificacionesAbierto.set(false);
  }

  cerrarDrawer(): void {
    this.drawerAbierto.set(false);
  }

  toggleNotificaciones(): void {
    this.notificacionesAbierto.update((abierto) => !abierto);
    if (this.notificacionesAbierto()) {
      this.notificacionService.asegurarCargadas().subscribe();
    }
  }

  marcarComoLeida(item: { id: string; leido: boolean }): void {
    if (item.leido) return;
    this.notificacionService.marcarComoLeida(item.id).subscribe();
  }

  marcarTodasComoLeidas(): void {
    this.notificacionService.marcarTodasComoLeidas().subscribe();
  }

  salir(): void {
    this.cerrarSesion.emit();
  }

  @HostListener('document:keydown.escape')
  alPresionarEscape(): void {
    this.cerrarDrawer();
    this.notificacionesAbierto.set(false);
  }

  @HostListener('document:click', ['$event'])
  alClicDocumento(evento: MouseEvent): void {
    const objetivo = evento.target as HTMLElement | null;
    if (!objetivo?.closest('[data-notif]')) {
      this.notificacionesAbierto.set(false);
    }
  }
}
