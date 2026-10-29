import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap } from 'rxjs';
import { API_URL } from '../constants/api.constants';
import { TenantService } from './tenant.service';

export interface TotalesCaja {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  general: number;
  /** `null` cuando el día ya está cerrado: el arqueo no guardó el conteo. */
  cantidadPagos: number | null;
}

export interface CierreCaja {
  id: string;
  barberiaId: string;
  fecha: string;
  estado: 'ABIERTO' | 'CERRADO';
  totalEfectivo: number;
  totalTarjeta: number;
  totalTransferencia: number;
  totalGeneral: number;
  cerradoAt: string | null;
}

export interface CajaDelDia {
  fecha: string;
  estado: 'ABIERTO' | 'CERRADO';
  totales: TotalesCaja;
  cierre: CierreCaja | null;
  cerradoAt: string | null;
}

/**
 * V3 fase 6 · caja del día.
 *
 * La sede viaja como `?shopId=` porque las rutas nacen sin `:shopId`
 * (`/caja/hoy`, `/caja/cierre`). El backend calcula el día en la zona de la sede
 * y devuelve cifras ya congeladas si hubo cierre: esta pantalla no recalcula
 * nada, solo pinta lo que el arqueo dice.
 */
@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  readonly caja = signal<CajaDelDia | null>(null);
  readonly cargando = signal(false);
  readonly cerrando = signal(false);
  readonly error = signal<string | null>(null);

  cargarHoy(): Observable<CajaDelDia | null> {
    const shopId = this.tenant.barberiaActivaId();
    if (!shopId) {
      this.error.set('No hay una sede activa.');
      return of(null);
    }

    this.cargando.set(true);
    this.error.set(null);

    return this.http
      .get<CajaDelDia>(`${API_URL}/caja/hoy?shopId=${shopId}`)
      .pipe(
        tap((caja) => {
          this.caja.set(caja);
          this.cargando.set(false);
        }),
        catchError((err) => {
          this.cargando.set(false);
          this.error.set(this.mensajeDeError(err, 'No se pudo cargar la caja del día.'));
          return of(null);
        }),
      );
  }

  /**
   * Sella el día. Un segundo cierre responde 409 `CAJA_YA_CERRADA`: se muestra el
   * mensaje del backend y se recarga el estado para pintar el cierre que ya
   * existía, en vez de dejar la pantalla creyendo que sigue abierta.
   */
  cerrarCaja(): Observable<CajaDelDia | null> {
    const shopId = this.tenant.barberiaActivaId();
    if (!shopId) {
      this.error.set('No hay una sede activa.');
      return of(null);
    }

    this.cerrando.set(true);
    this.error.set(null);

    return this.http.post<CajaDelDia>(`${API_URL}/caja/cierre?shopId=${shopId}`, {}).pipe(
      tap((caja) => {
        this.caja.set(caja);
        this.cerrando.set(false);
      }),
      catchError((err) => {
        this.cerrando.set(false);
        this.error.set(this.mensajeDeError(err, 'No se pudo cerrar la caja.'));
        if (err?.status === 409) this.cargarHoy().subscribe();
        return of(null);
      }),
    );
  }

  private mensajeDeError(err: any, porDefecto: string): string {
    const backend = err?.error?.mensaje || err?.error?.message;
    if (typeof backend === 'string' && backend.trim()) return backend;
    if (err?.status === 403) return 'Solo el administrador de la sede puede gestionar su caja.';
    return porDefecto;
  }
}
