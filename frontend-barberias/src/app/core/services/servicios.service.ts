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
      map(res => Array.isArray(res) ? res : (res.data || [])),
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
}
