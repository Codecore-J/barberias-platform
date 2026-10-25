import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, forkJoin } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';

export interface Servicio {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
  esCombo: boolean;
  barberiaId: string;
  fechaCreacion: string;
  estado?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServiciosService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  /**
   * Fase 5 (Punto 5.3): la sede viaja en la RUTA, nunca en una cabecera.
   * `/servicios` y `/catalogo/combos` dejan de existir como alias planos.
   */
  private get serviciosUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/services`;
  }

  private get combosUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/combos`;
  }

  readonly servicios = signal<Servicio[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * E2-07 · P-SD-1/P-SD-2: el panel de administración lee el catálogo con
   * `incluirCombos = true`, y eso cambia DOS cosas respecto a las vistas de
   * cliente:
   *
   *  - Se suman los COMBOS, que en la API son otro recurso (`/shops/:shopId/combos`).
   *    Sin ellos la pestaña «Combos» está siempre vacía, así que el
   *    `desactivarCombo` no tenía a quién llamar: era justo la acción que
   *    desbloquea el 422 `SERVICIO_EN_COMBO_ACTIVO` y no existía en la UI
   *    (P-SD-2). Los combos entran con `esCombo: true` para que la plantilla y
   *    el toggle elijan el endpoint correcto.
   *  - El admin recibe también los INACTIVOS (visibilidad por rol en el
   *    backend). Si la lista solo trajera ACTIVOS, desactivar un ítem lo hacía
   *    desaparecer y «Reactivar» quedaba inalcanzable desde la app (P-SD-1).
   *
   * El catálogo público, el wizard de reserva y el walk-in siguen llamando sin
   * argumento: solo servicios y solo ACTIVOS, como antes.
   */
  cargarServicios(incluirCombos = false): Observable<Servicio[]> {
    this.isLoading.set(true);
    this.error.set(null);

    const peticion$ = incluirCombos ? this.peticionCatalogoAdmin() : this.peticionServicios();

    return peticion$.pipe(
      tap((data: Servicio[]) => {
        this.servicios.set(data);
        this.isLoading.set(false);
      }),
      catchError(_err => {
        this.isLoading.set(false);
        this.error.set('No se pudieron cargar los servicios');
        return of([]);
      })
    );
  }

  private peticionServicios(): Observable<Servicio[]> {
    return this.http.get<any>(this.serviciosUrl).pipe(
      map(res => this.extraerLista(res).map((s: any) => this.aServicio(s))),
    );
  }

  /** Servicios + combos en una sola lista, como la pinta el panel de admin. */
  private peticionCatalogoAdmin(): Observable<Servicio[]> {
    const combos$ = this.http.get<any>(this.combosUrl).pipe(
      map(res => this.extraerLista(res).map((c: any) => this.aCombo(c))),
      // Un fallo al leer los combos no debe dejar al admin sin catálogo: se
      // degrada a solo servicios en vez de romper toda la pantalla.
      catchError(() => of([] as Servicio[])),
    );

    return forkJoin([this.peticionServicios(), combos$]).pipe(
      map(([servicios, combos]) =>
        [...servicios, ...combos].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      ),
    );
  }

  private extraerLista(res: any): any[] {
    return Array.isArray(res) ? res : (res?.data || []);
  }

  private aServicio(s: any): Servicio {
    return {
      ...s,
      duracionMinutos: s.duracionMinutos ?? s.duracionEstimada ?? 30,
      // La API no manda `esCombo` en los servicios. La tabla lo usa para elegir
      // el endpoint, así que se fija a `false` en vez de quedar indefinido.
      esCombo: s.esCombo ?? false,
    };
  }

  /**
   * El combo tiene otro nombre para las mismas columnas (`precioEspecial`,
   * `duracionPropia`) y no tiene fecha de creación, así que se normaliza a la
   * forma que ya consume la tabla.
   */
  private aCombo(c: any): Servicio {
    return {
      id: c.id,
      nombre: c.nombre,
      descripcion: c.descripcion ?? '',
      precio: Number(c.precioEspecial ?? 0),
      duracionMinutos: Number(c.duracionPropia ?? 0),
      esCombo: true,
      barberiaId: c.barberiaId,
      fechaCreacion: '',
      estado: c.estado,
    };
  }

  crearServicio(dto: any): Observable<Servicio> {
    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.post<Servicio>(this.serviciosUrl, payload).pipe(
      tap(() => {
        this.recargarCatalogo(); // Recargar tras crear
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al crear servicio');
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
    return this.http.patch<Servicio>(`${this.serviciosUrl}/${id}`, payload).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al actualizar servicio');
        throw err;
      })
    );
  }

  /**
   * E2-07: el servicio no se elimina, se DESACTIVA (`PATCH .../deactivate`). El
   * backend responde 422 y el `mensaje` explica la regla (`SERVICIO_EN_USO` si
   * hay reservas por confirmar, `SERVICIO_EN_COMBO_ACTIVO` si está en un combo),
   * así que se muestra tal cual en lugar de un texto genérico.
   */
  desactivarServicio(id: string): Observable<void> {
    this.isLoading.set(true);
    return this.http.patch<void>(`${this.serviciosUrl}/${id}/deactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al desactivar servicio');
        throw err;
      })
    );
  }

  /** Nombre antiguo de `desactivarServicio`, conservado para no romper llamadas. */
  eliminarServicio(id: string): Observable<void> {
    return this.desactivarServicio(id);
  }

  /** E2-07: la vuelta atrás que `DELETE` no ofrecía. */
  reactivarServicio(id: string): Observable<Servicio> {
    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${this.serviciosUrl}/${id}/reactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al reactivar servicio');
        throw err;
      })
    );
  }

  /** P-SD-2: apagar el combo es lo que libera a sus servicios del 422. */
  desactivarCombo(id: string): Observable<void> {
    this.isLoading.set(true);
    return this.http.patch<void>(`${this.combosUrl}/${id}/deactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al desactivar combo');
        throw err;
      })
    );
  }

  reactivarCombo(id: string): Observable<Servicio> {
    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${this.combosUrl}/${id}/reactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'Error al reactivar combo');
        throw err;
      })
    );
  }

  /**
   * Las seis escrituras del catálogo son del panel de administración y son las
   * únicas que necesitan recomponer servicios + combos: tras un toggle, la
   * tarjeta sigue en la lista con su estado nuevo.
   */
  private recargarCatalogo(): void {
    this.cargarServicios(true).subscribe();
  }
}
