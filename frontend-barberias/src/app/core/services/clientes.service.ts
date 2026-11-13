import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';
import { mensajeDeError } from '../utils/error-message.js';
import { MENSAJE_SIN_SEDE, haySede } from '../utils/sede.js';

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
  private readonly tenant = inject(TenantService);

  constructor() {
    this.tenant.registrarPurgadorLocal(() => this.limpiarEstadoLocal());
  }

  /**
   * Fase 5: la sede viaja en la ruta, nunca en la cabecera x-barberia-id.
   *
   * `null` sin sede: la ficha de cliente es siempre de una sede y `/shops/null`
   * no existe para el backend.
   */
  private get apiUrl(): string | null {
    const sedeId = this.tenant.barberiaActivaId();
    return haySede(sedeId) ? `${API_URL}/shops/${sedeId}/clients` : null;
  }

  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private limpiarEstadoLocal(): void {
    this.isLoading.set(false);
    this.error.set(null);
  }

  /**
   * Obtiene la ficha técnica de un cliente (notas y estadísticas limitadas a la barbería actual)
   */
  obtenerFichaCliente(clienteId: string): Observable<FichaCliente> {
    const base = this.apiUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<FichaCliente>(`${base}/${clienteId}/profile`).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al obtener la ficha del cliente'));
        return throwError(() => err);
      })
    );
  }

  /**
   * Guarda una nueva nota en la ficha del cliente
   */
  guardarNota(clienteId: string, contenido: string): Observable<NotaCliente> {
    const base = this.apiUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.post<NotaCliente>(`${base}/${clienteId}/notes`, { contenido }).pipe(
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al guardar la nota'));
        return throwError(() => err);
      })
    );
  }
}
