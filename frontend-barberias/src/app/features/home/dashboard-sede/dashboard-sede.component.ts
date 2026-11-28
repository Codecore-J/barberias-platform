import { Component, computed, inject, resource } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TenantService } from '../../../core/services/tenant.service';
import { ReservasService } from '../../../core/services/reservas.service';
import { PagosService } from '../../../core/services/pagos.service';
import { AuthService } from '../../../auth/auth.service';
import { rolEfectivo } from '../../../core/utils/rol';
import { haySede } from '../../../core/utils/sede';

/**
 * T-15 · Dashboard de SEDE (ADMIN_BARBERIA, o ADMINISTRADOR con sede elegida).
 *
 * Es la lógica que antes vivía dentro de `HomeComponent`, movida sin cambios de
 * comportamiento: agenda del día + historial de cobros, y las tres tarjetas de
 * ingresos, turnos y barbero top. Separarla del home permite que el dashboard de
 * plataforma ocupe el mismo sitio cuando no hay sede, en vez de dejar un panel
 * con $0 que no significaba nada.
 *
 * Dos detalles que se conservan del código original por ser correcciones reales:
 *
 *  · Sin sede NO se hace la petición (`/shops/null/...` → 400 del
 *    `ParseUUIDPipe`); aquí además se pinta el estado vacío orientado.
 *  · Un pago ANULADO no es ingreso y la fecha del dinero es `registradoAt`,
 *    no la de la cita (§7.4 / H68).
 */
@Component({
  selector: 'app-dashboard-sede',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, RouterLink],
  templateUrl: './dashboard-sede.component.html',
})
export class DashboardSedeComponent {
  private readonly tenantService = inject(TenantService);
  private readonly reservasService = inject(ReservasService);
  private readonly pagosService = inject(PagosService);
  private readonly authService = inject(AuthService);

  /**
   * T-26 · `GET /shops/:shopId/payments/history` es solo del ADMIN_BARBERIA.
   *
   * `vistaActual` del home manda a este dashboard también al ADMINISTRADOR
   * global cuando elige una sede, y esa pantalla pedía el historial igual: una
   * petición que el backend deniega siempre deja un error en la consola del
   * navegador (y, con él, la sensación de que la sede está rota). El rol que no
   * puede leer la caja no la pide.
   */
  readonly puedeVerCaja = computed(
    () => rolEfectivo(this.authService.authState().user?.roles) === 'ADMIN_BARBERIA',
  );

  /** ¿Hay una sede elegida? Con `false` no se pide nada y se muestra el vacío. */
  readonly haySedeActiva = computed(() => haySede(this.tenantService.barberiaActivaId()));
  readonly nombreSede = computed(() => this.tenantService.barberiaActiva()?.nombre ?? '');

  /**
   * F8 / T-85 · DOS lecturas independientes, no un `Promise.all`.
   *
   * Antes el dashboard esperaba a que la agenda Y la caja terminaran para pintar
   * la primera cifra: si `/payments/history` tardaba (o el rol no la pedía),
   * «Turnos completados» —que ya estaba en memoria— seguía escondido tras un
   * esqueleto único. Ahora cada tarjeta tiene su propio recurso y su propio
   * esqueleto: lo crítico se pinta en cuanto llega, y lo que falta se ve cargando
   * en su sitio.
   */
  private readonly agendaResource = resource({
    params: () => ({
      // Dependencia REACTIVA: al cambiar de sede el dashboard vuelve a leer.
      sede: this.tenantService.barberiaActivaId(),
      hoy: new Date().toISOString().split('T')[0],
    }),
    loader: async ({ params }) => {
      if (!haySede(params.sede)) return null;
      return firstValueFrom(this.reservasService.obtenerAgendaDiaria(params.hoy));
    },
  });

  /**
   * Caja del día. `verCaja` entra en las dependencias: si la sesión termina de
   * cargar después, el recurso se reevalúa con el rol correcto. Un rol que no
   * puede leer la caja no dispara la petición (T-26).
   */
  private readonly cajaResource = resource({
    params: () => ({
      sede: this.tenantService.barberiaActivaId(),
      verCaja: this.puedeVerCaja(),
    }),
    loader: async ({ params }) => {
      if (!haySede(params.sede) || !params.verCaja) return [];
      return firstValueFrom(this.pagosService.obtenerHistorial());
    },
  });

  readonly hoy = computed(() => new Date().toISOString().split('T')[0]);

  /**
   * Estados por tarjeta. Mientras carga no se pintan cifras y si falla se dice
   * por qué, en vez de mostrar el $0 de un resource vacío como si fuera la caja.
   */
  readonly cargandoAgenda = computed(
    () => this.haySedeActiva() && this.agendaResource.isLoading(),
  );
  readonly cargandoCaja = computed(
    () => this.haySedeActiva() && this.cajaResource.isLoading(),
  );
  readonly falloAgenda = computed(() => {
    if (!this.agendaResource.error()) return null;
    return 'No se pudieron cargar los turnos del día. Revisa tu conexión e inténtalo otra vez.';
  });
  readonly falloCaja = computed(() => {
    // La caja no es un fallo global: sin permiso no se pide y no hay error.
    if (!this.cajaResource.error()) return null;
    return 'No se pudo cargar la caja del día. Revisa tu conexión e inténtalo otra vez.';
  });

  private readonly agenda = computed(() => this.agendaResource.value() ?? []);
  private readonly pagos = computed(() => this.cajaResource.value() ?? []);

  readonly completadosHoy = computed(
    () => this.agenda().filter((t) => t.estado === 'COMPLETADA').length,
  );

  readonly canceladosHoy = computed(
    () =>
      this.agenda().filter(
        (t) => t.estado === 'CANCELADA' || t.estado === 'NO_ASISTIO',
      ).length,
  );

  /** H68 · ingresos del DÍA desde la tabla de pagos, sin los anulados. */
  readonly ingresosHoy = computed(() => {
    const hoy = this.hoy();

    return this.pagos()
      .filter((p) => p.estadoPago !== 'ANULADO' && (p.registradoAt ?? '').startsWith(hoy))
      .reduce((acc, p) => acc + Number(p.monto || 0), 0);
  });

  /**
   * Barbero con más citas COMPLETADAS. El campo es `barbero.nombre`: el backend
   * (`obtenerAgendaDiaria`) devuelve `{ id, nombre }`, no `nombreCompleto`.
   */
  readonly barberoProductivo = computed(() => {
    const conteo = new Map<string, number>();
    for (const turno of this.agenda()) {
      if (turno.estado !== 'COMPLETADA') continue;
      const nombre = turno.barbero?.nombre ?? 'Sin Asignar';
      conteo.set(nombre, (conteo.get(nombre) ?? 0) + 1);
    }

    let mejor = 'N/A';
    let maximo = 0;
    for (const [nombre, citas] of conteo) {
      if (citas > maximo) {
        maximo = citas;
        mejor = nombre;
      }
    }
    return mejor;
  });

  recargar(): void {
    this.agendaResource.reload();
    this.cajaResource.reload();
  }
}
