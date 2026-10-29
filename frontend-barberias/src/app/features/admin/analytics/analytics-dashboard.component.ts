import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AnalyticsService, ShopAnalyticsResponse, ShopsOverviewResponse } from '../../../core/services/analytics.service';
import { TenantService } from '../../../core/services/tenant.service';

@Component({
  selector: 'app-analytics-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analytics-dashboard.component.html',
  styleUrls: ['./analytics-dashboard.component.css'],
})
export class AnalyticsDashboardComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);

  data: ShopAnalyticsResponse | null = null;
  overview: ShopsOverviewResponse | null = null;
  loading = false;
  cargandoOverview = false;
  exportando = false;
  error: string | null = null;
  errorOverview: string | null = null;

  desde: string = '';
  hasta: string = '';

  /** Filtro rápido activo, solo para resaltar el botón correspondiente. */
  filtroActivo: '7' | '30' | 'mes' | 'custom' = '30';

  constructor(
    private analyticsService: AnalyticsService,
    private tenantService: TenantService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.aplicarFiltroRapido('30');
  }

  aplicarFiltroRapido(dias: '7' | '30' | 'mes'): void {
    const today = new Date();
    const hastaDate = new Date(today);
    const desdeDate = new Date(today);

    if (dias === '7') {
      desdeDate.setDate(today.getDate() - 7);
    } else if (dias === '30') {
      desdeDate.setDate(today.getDate() - 30);
    } else if (dias === 'mes') {
      desdeDate.setDate(1);
    }

    this.desde = this.formatDate(desdeDate);
    this.hasta = this.formatDate(hastaDate);
    this.filtroActivo = dias;
    this.recargar();
  }

  /** El botón «Aplicar» usa las fechas escritas a mano. */
  aplicarRangoManual(): void {
    if (!this.desde || !this.hasta) {
      this.error = 'Indica la fecha "Desde" y la fecha "Hasta" para aplicar el rango.';
      return;
    }
    if (this.desde > this.hasta) {
      this.error = 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".';
      return;
    }
    this.filtroActivo = 'custom';
    this.recargar();
  }

  recargar(): void {
    this.cargar();
    this.cargarOverview();
  }

  cargar(): void {
    const shopId = this.tenantService.barberiaActivaId();
    if (!shopId) {
      this.loading = false;
      this.data = null;
      this.error = 'No hay una sede activa seleccionada. Elige una barbería para ver sus analíticas.';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.error = null;

    this.analyticsService
      .getAnalytics(this.desde || undefined, this.hasta || undefined)
      .pipe(
        // `finalize` corre en next, error y unsubscribe: la pantalla no puede
        // quedarse en «Cargando...» porque una petición falle o se cancele.
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (res) => {
          this.data = res;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.data = null;
          this.error =
            err?.error?.mensaje || err?.error?.message || 'No se pudieron cargar las analíticas de la sede.';
          this.cdr.markForCheck();
        },
      });
  }

  cargarOverview(): void {
    this.cargandoOverview = true;
    this.errorOverview = null;

    this.analyticsService
      .getShopsOverview(this.desde || undefined, this.hasta || undefined)
      .pipe(
        finalize(() => {
          this.cargandoOverview = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (res) => {
          this.overview = res;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.overview = null;
          this.errorOverview =
            err?.error?.mensaje || err?.error?.message || 'No se pudo cargar el resumen multisede.';
          this.cdr.markForCheck();
        },
      });
  }

  /** Paso 13 · pide el CSV y lo entrega como descarga del navegador. */
  exportarCsv(): void {
    if (this.exportando) return;

    this.exportando = true;
    this.error = null;

    this.analyticsService
      .exportAnalytics(this.desde || undefined, this.hasta || undefined)
      .pipe(
        finalize(() => {
          this.exportando = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = `reporte-barberia-${this.tenantService.barberiaActivaId() ?? 'sede'}.csv`;
          enlace.click();
          window.URL.revokeObjectURL(url);
        },
        error: () => {
          this.error = 'No se pudo exportar el reporte. Inténtalo de nuevo.';
        },
      });
  }

  irASede(barberiaId: string): void {
    this.tenantService.seleccionarBarberia(barberiaId).subscribe({
      next: () => {
        this.router.navigate(['/admin/agenda']);
      },
      error: () => {
        this.router.navigate(['/admin/agenda']);
      },
    });
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getObjectKeys(obj: Record<string, number> | undefined): string[] {
    return obj ? Object.keys(obj) : [];
  }
}
