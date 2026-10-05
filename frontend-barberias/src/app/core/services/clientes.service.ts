import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export interface NotaCliente {
  id: string;
  contenido: string;
  fechaCreacion: string;
}

export interface FichaCliente {
  id: string;
  nombre: string;
  telefono: string;
  totalCitas: number;
  totalCanceladas: number;
  notas: NotaCliente[];
}

@Injectable({
  providedIn: 'root'
})
export class ClientesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/clientes`;

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * Obtiene la ficha técnica de un cliente (notas y estadísticas limitadas a la barbería actual)
   */
  obtenerFichaCliente(clienteId: string): Observable<FichaCliente> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<FichaCliente>(`${this.apiUrl}/${clienteId}/ficha`).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al obtener la ficha del cliente');
        return throwError(() => err);
      })
    );
  }

  /**
   * Guarda una nueva nota en la ficha del cliente
   */
  guardarNota(clienteId: string, contenido: string): Observable<NotaCliente> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.post<NotaCliente>(`${this.apiUrl}/${clienteId}/notas`, { contenido }).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al guardar la nota');
        return throwError(() => err);
      })
    );
  }
}
