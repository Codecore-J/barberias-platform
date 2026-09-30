import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export interface Servicio {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
  esCombo: boolean;
  barberiaId: string;
  fechaCreacion: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServiciosService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/servicios`;

  readonly servicios = signal<Servicio[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  cargarServicios(): Observable<Servicio[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(this.apiUrl).pipe(
      map(res => {
        const raw = Array.isArray(res) ? res : (res.data || []);
        return raw.map((s: any) => ({
          ...s,
          duracionMinutos: s.duracionMinutos ?? s.duracionEstimada ?? 30,
        }));
      }),
      tap((data: Servicio[]) => {
        this.servicios.set(data);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set('No se pudieron cargar los servicios');
        return of([]);
      })
    );
  }

  crearServicio(dto: any): Observable<Servicio> {
    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.post<Servicio>(this.apiUrl, payload).pipe(
      tap(() => {
        this.cargarServicios().subscribe(); // Recargar tras crear
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al crear servicio');
        throw err;
      })
    );
  }

  actualizarServicio(id: string, dto: any): Observable<Servicio> {
    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.patch<Servicio>(`${this.apiUrl}/${id}`, payload).pipe(
      tap(() => {
        this.cargarServicios().subscribe();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al actualizar servicio');
        throw err;
      })
    );
  }

  eliminarServicio(id: string): Observable<void> {
    this.isLoading.set(true);
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      tap(() => {
        this.cargarServicios().subscribe();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al eliminar servicio');
        throw err;
      })
    );
  }
}
