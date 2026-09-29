import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface BarberiaResumen {
  id: string;
  nombre: string;
  descripcion?: string | null;
  telefono: string;
  ubicacion: string;
  codigoAcceso: string;
  enlaceUnico: string;
  responsableId: string;
  estado: string;
  esBarberiaActiva?: boolean;
  estadoVinculacion?: 'ACTIVO' | 'PENDIENTE';
}

import { API_URL } from '../constants/api.constants.js';

@Injectable({
  providedIn: 'root',
})
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/barberias`;
  private readonly storageKey = 'active_barberia_id';

  // Signals reactivos para el tenant
  readonly barberiaActiva = signal<BarberiaResumen | null>(null);
  readonly barberiasVinculadas = signal<BarberiaResumen[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Computeds útiles
  readonly tieneBarberiaActiva = computed(() => !!this.barberiaActiva());
  readonly barberiaActivaId = computed(() => this.barberiaActiva()?.id ?? null);
  readonly nombreBarberiaActiva = computed(
    () => this.barberiaActiva()?.nombre ?? 'Sin Barbería Seleccionada',
  );

  constructor() {
    this.cargarCacheInicial();
  }

  private cargarCacheInicial() {
    const cached = localStorage.getItem('active_barberia_data');
    if (cached) {
      try {
        this.barberiaActiva.set(JSON.parse(cached));
      } catch {
        localStorage.removeItem('active_barberia_data');
      }
    }
  }

  /**
   * Carga las barberías vinculadas del usuario y determina la activa.
   */
  cargarBarberias(): Observable<BarberiaResumen[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(this.apiUrl).pipe(
      map((res) => (Array.isArray(res) ? res : res.data ?? [])),
      tap((barberias: BarberiaResumen[]) => {
        this.barberiasVinculadas.set(barberias);
        this.isLoading.set(false);

        // Buscar barbería marcada como activa o en caché
        const guardadaId = localStorage.getItem(this.storageKey);
        const activa =
          barberias.find((b) => b.id === guardadaId) ??
          barberias.find((b) => b.esBarberiaActiva) ??
          (barberias.length > 0 ? barberias[0] : null);

        if (activa) {
          this.setBarberiaActiva(activa);
        }
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al cargar barberías');
        return of([]);
      }),
    );
  }

  /**
   * Cambia la barbería activa para el usuario y sincroniza con el backend.
   */
  seleccionarBarberia(barberiaId: string): Observable<any> {
    this.isLoading.set(true);
    return this.http.patch(`${this.apiUrl}/${barberiaId}/seleccionar`, {}).pipe(
      tap(() => {
        const barberia = this.barberiasVinculadas().find((b) => b.id === barberiaId);
        if (barberia) {
          this.setBarberiaActiva(barberia);
        }
        this.isLoading.set(false);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'No se pudo seleccionar la barbería');
        throw err;
      }),
    );
  }

  /**
   * Vincula al usuario con una barbería usando un código de acceso de 8 caracteres.
   */
  vincularBarberia(codigoAcceso: string): Observable<any> {
    this.isLoading.set(true);
    return this.http.post(`${this.apiUrl}/vincular`, { codigoAcceso }).pipe(
      tap(() => {
        // Al vincular exitosamente, recargamos la lista
        this.cargarBarberias().subscribe();
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Código inválido o error al vincular');
        throw err;
      }),
    );
  }

  /**
   * Crea una nueva barbería y el usuario actual queda como Dueño/Responsable
   */
  crearBarberia(dto: { nombre: string; ubicacion: string; telefono: string; descripcion?: string }): Observable<any> {
    this.isLoading.set(true);
    return this.http.post(this.apiUrl, dto).pipe(
      tap((nuevaBarberia) => {
        // Recargar la lista y seleccionarla
        this.cargarBarberias().subscribe(() => {
           this.seleccionarBarberia((nuevaBarberia as any).id || (nuevaBarberia as any).data?.id).subscribe();
        });
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al crear la barbería');
        throw err;
      })
    );
  }

  setBarberiaActiva(barberia: BarberiaResumen | null) {
    this.barberiaActiva.set(barberia);
    if (barberia) {
      localStorage.setItem(this.storageKey, barberia.id);
      localStorage.setItem('active_barberia_data', JSON.stringify(barberia));
    } else {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem('active_barberia_data');
    }
  }

  limpiarTenant() {
    this.barberiaActiva.set(null);
    this.barberiasVinculadas.set([]);
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem('active_barberia_data');
  }
}
