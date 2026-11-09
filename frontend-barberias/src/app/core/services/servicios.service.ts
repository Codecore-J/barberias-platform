import { Injectable, inject, signal } from '@angular/core';
import { mensajeDeError } from '../utils/error-message.js';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, forkJoin } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';
import { AuthService } from '../auth/auth.service';

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

/**
 * Flag para saber si estamos operando como admin global sin sede asignada.
 * Esto afecta qué endpoints usan y cómo mostramos información al usuario.
 */
readonly esAdminGlobalSinSede = computed(() => {
  const auth = inject(AuthService);
  const tenant = inject(TenantService);
  return auth.authState().user?.roles?.includes('ADMINISTRADOR') &&
    !tenant.tieneBarberiaActiva();
});

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
   * URL base para servicios: usa la sede activa o cae de vuelta al catálogo global.
   * Admin global sin sede usará un endpoint alternativo o mostrará aviso.
   */
  private get serviciosUrl(): string {
    const sedeId = this.tenant.barberiaActivaId();
    // Si no hay sede y es admin global, usamos un endpoint de catálogo global
    if (!sedeId && this.esAdminGlobalSinSede) {
      return `${API_URL}/catalogo/admin/servicios-todos`;
    }
    return `${API_URL}/shops/${sedeId ?? ''}/services`;
  }

  private get combosUrl(): string {
    const sedeId = this.tenant.barberiaActivaId();
    if (!sedeId && this.esAdminGlobalSinSede) {
      return `${API_URL}/catalogo/admin/combos-todos`;
    }
    return `${API_URL}/shops/${sedeId ?? ''}/combos`;
  }

  readonly servicios = signal<Servicio[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private limpiarEstadoLocal(): void {
    this.servicios.set([]);
    this.isLoading.set(false);
    this.error.set(null);
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
    this.isLoading.set(true);
    this.error.set(null);

    // 🔧 MEJORA: Validación previa para admin global sin sede
    if (this.esAdminGlobalSinSede) {
      this.toastWarning(
        'No tienes una sede activa seleccionada. El catálogo se mostrará en modo lectura global.',
        'Sede requerida'
      );
      // Cargamos el catálogo global en modo lectura para el admin
      return this.catalogoGlobal(true);
    }

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
      }),
    );
  }

  /** Carga el catálogo global para admin sin sede (modo lectura) */
  private catalogoGlobal(incluirCombos = false): Observable<Servicio[]> {
    this.isLoading.set(true);

    const peticion$ = incluirCombos
      ? this.http.get<any>(`${API_URL}/catalogo/admin/servicios-todos?includeCombos=true`).pipe(
          map(res => this.normalizar(res).map((s: any) => this.aServicio(s)))
        )
      : this.http.get<any>(`${API_URL}/catalogo/admin/servicios-todos`).pipe(
          map(res => this.normalizar(res).map((s: any) => this.aServicio(s)))
        );

    return peticion$.pipe(
      tap((data: Servicio[]) => {
        this.servicios.set(data);
        this.isLoading.set(false);
      }),
      catchError(_err => {
        this.isLoading.set(false);
        this.error.set('No se pudo cargar el catálogo global');
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

  crearServicio(dto: any): Observable<Servicio> {
    this.isLoading.set(true);
    const payload = {
      ...dto,
      duracionEstimada: dto.duracionEstimada ?? dto.duracionMinutos ?? 30,
    };
    return this.http.post<Servicio>(this.serviciosUrl, payload).pipe(
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
    this.isLoading.set(true);
    return this.http.patch<void>(`${this.serviciosUrl}/${id}/deactivate`, {}).pipe(
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
    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${this.serviciosUrl}/${id}/reactivate`, {}).pipe(
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
    this.isLoading.set(true);
    return this.http.patch<void>(`${this.combosUrl}/${id}/deactivate`, {}).pipe(
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
    this.isLoading.set(true);
    return this.http.patch<Servicio>(`${this.combosUrl}/${id}/reactivate`, {}).pipe(
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

  /** Muestra un toast informativo (usando el Injector para evitar problemas de
   *  inyección circular en constructores de servicio). */
  private toastWarning(mensaje: string, titulo: string): void {
    const toast = inject(ToastService);
    toast.warning(mensaje, titulo);
  }
}