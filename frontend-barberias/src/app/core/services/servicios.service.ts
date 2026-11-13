import { Injectable, inject, signal, computed } from '@angular/core';
import { mensajeDeError } from '../utils/error-message.js';
import { MENSAJE_SIN_SEDE, haySede } from '../utils/sede.js';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, forkJoin, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';
import { AuthService } from '../../auth/auth.service';

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

@Injectable({ providedIn: 'root' })
export class ServiciosService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);
  private readonly auth = inject(AuthService);

  constructor() {
    this.tenant.registrarPurgadorLocal(() => this.limpiarEstadoLocal());
  }

  /** Signals de estado */
  readonly servicios = signal<Servicio[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /** Indica si hay una sede activa seleccionada o disponible */
  readonly tieneSedeActiva = computed(() => this.tenant.tieneBarberiaActiva());

  private limpiarEstadoLocal(): void {
    this.servicios.set([]);
    this.isLoading.set(false);
    this.error.set(null);
  }

  /** 
   * E2-07: verifica si el usuario actual puede gestionar servicios.
   * Admin global siempre puede, pero necesita contexto de sede para operaciones específicas.
   */
  readonly puedeGestionar = computed(() => {
    const rol = this.auth.authState().user?.roles;
    if (!rol || rol.length === 0) return false;
    if (rol.includes('ADMINISTRADOR')) return true;
    if (rol.includes('ADMIN_BARBERIA')) return true;
    if (rol.includes('BARBERO')) return true;
    return false;
  });

  /**
   * El catálogo es SIEMPRE de una sede.
   *
   * Antes, sin sede, esta URL salía como `/shops//services` (doble barra → 404) y
   * el "modo global" llamaba a `/catalogo/admin/servicios-todos`, una ruta que no
   * existe en la API. Ahora sin sede no se compone ninguna URL: los getters
   * devuelven `null` y cada método decide (vacío en lectura, error en escritura).
   */
  private get serviciosUrl(): string | null {
    const sedeId = this.tenant.barberiaActivaId();
    return haySede(sedeId) ? `${API_URL}/shops/${sedeId}/services` : null;
  }

  private get combosUrl(): string | null {
    const sedeId = this.tenant.barberiaActivaId();
    return haySede(sedeId) ? `${API_URL}/shops/${sedeId}/combos` : null;
  }

  /** E2-07 · P-SD-1/P-SD-2: el panel de administración lee el catálogo con
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
    const serviciosBase = this.serviciosUrl;
    const combosBase = this.combosUrl;
    if (!serviciosBase || !combosBase) {
      this.isLoading.set(false);
      this.servicios.set([]);
      this.error.set(MENSAJE_SIN_SEDE);
      return of([]);
    }

    this.isLoading.set(true);
    this.error.set(null);

    const peticion$ = incluirCombos
      ? this.peticionCatalogoAdmin(serviciosBase, combosBase)
      : this.peticionServicios(serviciosBase);

    return peticion$.pipe(
      tap((data: Servicio[]) => {
        this.servicios.set(data);
        this.isLoading.set(false);
      }),
      catchError(_err => {
        this.isLoading.set(false);
        this.error.set('No se pudieron cargar los servicios');
        return of([]);
      }),
    );
  }

  private normalizar(res: any): any[] {
    return Array.isArray(res) ? res : (res?.data || []);
  }

  private aServicio(s: any): Servicio {
    return {
      ...s,
      duracionMinutos: s.duracionMinutos ?? s.duracionEstimada ?? 30,
      esCombo: s.esCombo ?? false,
    };
  }

  private peticionServicios(base: string): Observable<Servicio[]> {
    return this.http
      .get<any>(base)
      .pipe(map((res) => this.normalizar(res).map((s: any) => this.aServicio(s))));
  }

  /** Servicios + combos en una sola lista, como la pinta el panel de admin. */
  private peticionCatalogoAdmin(serviciosBase: string, combosBase: string): Observable<Servicio[]> {
    const combos$ = this.http.get<any>(combosBase).pipe(
      map((res) => this.normalizar(res).map((c: any) => this.aCombo(c))),
      // Un fallo al leer los combos no debe dejar al admin sin catálogo: se
      // degrada a solo servicios en vez de romper toda la pantalla.
      catchError(() => of([] as Servicio[])),
    );

    return forkJoin([this.peticionServicios(serviciosBase), combos$]).pipe(
      map(([servicios, combos]) =>
        [...servicios, ...combos].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      ),
    );
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
    const base = this.serviciosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.post<Servicio>(base, payload).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al crear servicio'));
        throw err;
      }),
    );
  }

  actualizarServicio(id: string, dto: any): Observable<Servicio> {
    const base = this.serviciosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.patch<Servicio>(`${base}/${id}`, payload).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al actualizar servicio'));
        throw err;
      }),
    );
  }

  /** Nombre antiguo de `desactivarServicio`, conservado para no romper llamadas. */
  eliminarServicio(id: string): Observable<void> {
    return this.desactivarServicio(id);
  }

  desactivarServicio(id: string): Observable<void> {
    const base = this.serviciosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    return this.http.patch<void>(`${base}/${id}/deactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al desactivar servicio'));
        throw err;
      }),
    );
  }

  reactivarServicio(id: string): Observable<Servicio> {
    const base = this.serviciosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${base}/${id}/reactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al reactivar servicio'));
        throw err;
      }),
    );
  }

  desactivarCombo(id: string): Observable<void> {
    const base = this.combosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    return this.http.patch<void>(`${base}/${id}/deactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al desactivar combo'));
        throw err;
      }),
    );
  }

  reactivarCombo(id: string): Observable<Servicio> {
    const base = this.combosUrl;
    if (!base) return throwError(() => new Error(MENSAJE_SIN_SEDE));

    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${base}/${id}/reactivate`, {}).pipe(
      tap(() => {
        this.recargarCatalogo();
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al reactivar combo'));
        throw err;
      }),
    );
  }

  /** Las seis escrituras del catálogo son del panel de administración y son las
   * únicas que necesitan recomponer servicios + combos: tras un toggle, la
   * tarjeta sigue en la lista con su estado nuevo.
   */
  private recargarCatalogo(): void {
    this.cargarServicios(true).subscribe();
  }

}
