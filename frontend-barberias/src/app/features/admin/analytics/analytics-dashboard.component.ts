import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  data: ShopAnalyticsResponse | null = null;
  overview: ShopsOverviewResponse | null = null;
  loading = false;
  exportando = false;
  error: string | null = null;

  desde: string = '';
  hasta: string = '';

  constructor(
    private analyticsService: AnalyticsService,
    private tenantService: TenantService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.aplicarFiltroRapido('30');
    this.cargarOverview();
  }

  aplicarFiltroRapido(dias: string): void {
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
    this.cargar();
    this.cargarOverview();
  }

  cargar(): void {
    this.loading = true;
    this.error = null;
    this.analyticsService.getAnalytics(this.desde || undefined, this.hasta || undefined).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Error al cargar analíticas';
        this.loading = false;
      },
    });
  }

  cargarOverview(): void {
    this.analyticsService.getShopsOverview(this.desde || undefined, this.hasta || undefined).subscribe({
      next: (res) => {
        this.overview = res;
      },
      error: () => {
        this.overview = null;
      },
    });
  }

  /** Paso 13 · pide el CSV y lo entrega como descarga del navegador. */
  exportarCsv(): void {
    this.exportando = true;
    this.analyticsService
      .exportAnalytics(this.desde || undefined, this.hasta || undefined)
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = `reporte-barberia-${this.tenantService.barberiaActivaId() ?? 'sede'}.csv`;
          enlace.click();
          window.URL.revokeObjectURL(url);
          this.exportando = false;
        },
        error: () => {
          this.error = 'No se pudo exportar el reporte';
          this.exportando = false;
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
