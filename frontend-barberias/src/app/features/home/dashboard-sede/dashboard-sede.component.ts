import { Component, computed, inject, resource } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TenantService } from '../../../core/services/tenant.service';
import { ReservasService } from '../../../core/services/reservas.service';
import { PagosService } from '../../../core/services/pagos.service';
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

  /** ¿Hay una sede elegida? Con `false` no se pide nada y se muestra el vacío. */
  readonly haySedeActiva = computed(() => haySede(this.tenantService.barberiaActivaId()));
  readonly nombreSede = computed(() => this.tenantService.barberiaActiva()?.nombre ?? '');

  private readonly metricasResource = resource({
    params: () => ({
      // Dependencia REACTIVA: al cambiar de sede el dashboard vuelve a leer.
      sede: this.tenantService.barberiaActivaId(),
      hoy: new Date().toISOString().split('T')[0],
    }),
    loader: async ({ params }) => {
      if (!haySede(params.sede)) return null;

      const [agenda, pagos] = await Promise.all([
        firstValueFrom(this.reservasService.obtenerAgendaDiaria(params.hoy)),
        firstValueFrom(this.pagosService.obtenerHistorial()),
      ]);
      return { hoy: params.hoy, agenda, pagos };
    },
  });

  /**
   * Cargando / error / ok son estados EXCLUYENTES: mientras carga no se pintan
   * cifras y si falla se dice por qué, en vez de mostrar el $0 de un resource
   * vacío como si fuera la caja del día.
   */
  readonly cargando = computed(
    () => this.haySedeActiva() && this.metricasResource.isLoading(),
  );
  readonly fallo = computed(() => {
    const error = this.metricasResource.error();
    if (!error) return null;
    return 'No se pudieron cargar las métricas de la sede. Revisa tu conexión e inténtalo otra vez.';
  });

  private readonly metricas = computed(() => this.metricasResource.value() ?? null);

  readonly completadosHoy = computed(
    () => (this.metricas()?.agenda ?? []).filter((t) => t.estado === 'COMPLETADA').length,
  );

  readonly canceladosHoy = computed(
    () =>
      (this.metricas()?.agenda ?? []).filter(
        (t) => t.estado === 'CANCELADA' || t.estado === 'NO_ASISTIO',
      ).length,
  );

  /** H68 · ingresos del DÍA desde la tabla de pagos, sin los anulados. */
  readonly ingresosHoy = computed(() => {
    const datos = this.metricas();
    if (!datos) return 0;

    return datos.pagos
      .filter((p) => p.estadoPago !== 'ANULADO' && (p.registradoAt ?? '').startsWith(datos.hoy))
      .reduce((acc, p) => acc + Number(p.monto || 0), 0);
  });

  /**
   * Barbero con más citas COMPLETADAS. El campo es `barbero.nombre`: el backend
   * (`obtenerAgendaDiaria`) devuelve `{ id, nombre }`, no `nombreCompleto`.
   */
  readonly barberoProductivo = computed(() => {
    const conteo = new Map<string, number>();
    for (const turno of this.metricas()?.agenda ?? []) {
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
    this.metricasResource.reload();
  }
}
