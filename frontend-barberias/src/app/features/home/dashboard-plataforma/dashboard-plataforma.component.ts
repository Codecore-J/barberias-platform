import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../../../core/services/analytics.service';
import type { MetricasPlataformaHoy } from '../../../core/services/analytics.service';
import { AuthService } from '../../../auth/auth.service';
import { mensajeDeError } from '../../../core/utils/error-message';

/**
 * T-15 · Dashboard de PLATAFORMA (ADMINISTRADOR sin sede activa).
 *
 * Es la vista que faltaba: el home compartido pedía la agenda de una sede
 * (`/shops/:id/appointments/day`) y, sin sede seleccionada, el ADMINISTRADOR
 * global veía el panel entero en $0/N/A. Aquí no hay sede: se pide UNA lectura
 * agregada al backend (`GET /analytics/plataforma/hoy`) con cifras de toda la red.
 *
 * Tres estados, nunca mezclados (es el requisito central de la tarea):
 *
 *   · `cargando` → esqueletos, ni un cero.
 *   · `error`    → el motivo real y un botón de reintento. Un cero aquí mentiría.
 *   · `ok`       → los números del backend, donde un 0 ES un cero de verdad y se
 *                  puede decir con todas las letras («sin citas hoy»).
 */
@Component({
  selector: 'app-dashboard-plataforma',
  standalone: true,
  imports: [CommonModule, RouterLink, CurrencyPipe],
  templateUrl: './dashboard-plataforma.component.html',
})
export class DashboardPlataformaComponent {
  private readonly analytics = inject(AnalyticsService);
  private readonly authService = inject(AuthService);

  readonly estado = signal<'cargando' | 'ok' | 'error'>('cargando');
  readonly metricas = signal<MetricasPlataformaHoy | null>(null);
  readonly error = signal<string | null>(null);

  /** Nombre de la cuenta que está mirando el panel: da contexto a «toda la red». */
  readonly nombre = computed(
    () => this.authService.authState().user?.nombreCompleto ?? 'Administrador',
  );

  /** Fecha que el backend midió, en formato local legible (dd/mm/aaaa). */
  readonly fechaLegible = computed(() => {
    const etiqueta = this.metricas()?.fecha;
    if (!etiqueta) return '';
    const [anio, mes, dia] = etiqueta.split('-');
    return `${dia}/${mes}/${anio}`;
  });

  constructor() {
    this.cargar();
  }

  /**
   * Una sola petición por intento. `finalize` no se usa: el estado se escribe en
   * cada rama para que un error no deje la pantalla «cargando» para siempre.
   */
  cargar(): void {
    this.estado.set('cargando');
    this.error.set(null);

    this.analytics.getMetricasPlataformaHoy().subscribe({
      next: (metricas) => {
        this.metricas.set(metricas);
        this.estado.set('ok');
      },
      error: (err: unknown) => {
        this.metricas.set(null);
        this.error.set(
          mensajeDeError(
            err,
            'No se pudieron cargar las métricas de la plataforma. Inténtalo de nuevo.',
          ),
        );
        this.estado.set('error');
      },
    });
  }
}
