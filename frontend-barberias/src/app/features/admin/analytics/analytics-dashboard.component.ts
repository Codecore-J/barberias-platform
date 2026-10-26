import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService, ShopAnalyticsResponse } from '../../../core/services/analytics.service';

@Component({
  selector: 'app-analytics-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analytics-dashboard.component.html',
  styleUrls: ['./analytics-dashboard.component.css'],
})
export class AnalyticsDashboardComponent implements OnInit {
  data: ShopAnalyticsResponse | null = null;
  loading = false;
  error: string | null = null;

  desde: string = '';
  hasta: string = '';

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit(): void {
    this.aplicarFiltroRapido('30');
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
