import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';

/** Categoría de servicio de la sede (V3 · catálogo híbrido). */
export interface CategoriaServicio {
  id: string;
  barberiaId: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  /** Cuántos servicios ACTIVOS cuelgan de ella; lo calcula el backend. */
  serviciosActivos: number;
}

/** Servicio propio de un barbero dentro de una categoría de la sede. */
export interface ServicioBarbero {
  id: string;
  categoriaId: string;
  barberoId: string;
  nombrePersonalizado: string;
  precio: number;
  duracionMinutos: number;
  activo: boolean;
  categoria?: { id: string; nombre: string; activa?: boolean };
}

/** Servicio de la vitrina del cliente: ya normalizado para pintarlo. */
export interface ServicioDeCatalogo {
  id: string;
  nombre: string;
  precio: number;
  duracionMinutos: number;
  barbero: { id: string; nombre: string };
}

/** Categoría con sus servicios activos, como los agrupa la vitrina. */
export interface CategoriaDelCatalogo {
  id: string;
  nombre: string;
  descripcion: string | null;
  servicios: ServicioDeCatalogo[];
}

export interface CrearCategoriaDto {
  nombre: string;
  descripcion?: string;
}

export interface ActualizarCategoriaDto {
  nombre?: string;
  descripcion?: string;
  activa?: boolean;
}

export interface CrearServicioBarberoDto {
  nombre: string;
  precio: number;
  duracionMinutos: number;
  categoriaId: string;
}

export interface ActualizarServicioBarberoDto {
  nombre?: string;
  precio?: number;
  duracionMinutos?: number;
  categoriaId?: string;
  activo?: boolean;
}

/**
 * V3 · tarjetas HTTP del catálogo híbrido.
 *
 * El modelo es «categorización estricta con nomenclatura libre»: el ADMIN de la
 * sede crea las CATEGORÍAS y cada BARBERO publica dentro sus servicios con
 * precio y duración propios. La sede viaja siempre en la ruta (Fase 5), así que
 * el `barberiaId` no aparece en ningún cuerpo.
 *
 * Los errores NO se silencian: se traduce el contrato D40 del backend
 * (`{ statusCode, codigo, mensaje }`) a un texto mostrable y se relanza el error
 * para que la pantalla decida si lo pinta como alerta o como toast. El 403 y el
 * 409 tienen mensaje propio porque son los dos que el usuario provoca con
 * facilidad: tocar la sede equivocada o repetir una categoría que ya existe.
 */
@Injectable({
  providedIn: 'root',
})
export class CatalogoHibridoService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantService);

  private get categoriasUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/categorias`;
  }

  private get misServiciosUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/mis-servicios`;
  }

  private get catalogoUrl(): string {
    return `${API_URL}/shops/${this.tenant.barberiaActivaId()}/servicios`;
  }

  // ── Estado de las categorías (panel del ADMIN de la sede) ────────────────
  readonly categorias = signal<CategoriaServicio[]>([]);
  readonly cargandoCategorias = signal<boolean>(false);
  readonly guardandoCategoria = signal<boolean>(false);
  readonly errorCategorias = signal<string | null>(null);

  // ── Estado de los servicios propios (panel del BARBERO) ──────────────────
  readonly misServicios = signal<ServicioBarbero[]>([]);
  readonly cargandoMisServicios = signal<boolean>(false);
  readonly guardandoServicio = signal<boolean>(false);
  readonly errorMisServicios = signal<string | null>(null);

  // ── Estado de la vitrina del cliente ────────────────────────────────────
  readonly catalogo = signal<CategoriaDelCatalogo[]>([]);
  readonly cargandoCatalogo = signal<boolean>(false);
  readonly errorCatalogo = signal<string | null>(null);

  /** Texto mostrable de un error HTTP, con el mensaje D40 del backend si lo hay. */
  static mensajeDeError(error: any, porDefecto: string): string {
    const mensaje: string | undefined = error?.error?.mensaje || error?.error?.message;

    switch (error?.status) {
      case 403:
        return mensaje || 'No tienes permisos para esta acción en esta sede.';
      case 404:
        return mensaje || 'El recurso ya no existe en esta sede.';
      case 409:
        return mensaje || 'La operación choca con el estado actual. Recarga e inténtalo de nuevo.';
      case 422:
        return mensaje || 'La operación no cumple una regla de negocio.';
      default:
        return mensaje || porDefecto;
    }
  }

  private sinSede<T>(valorPorDefecto: T): Observable<T> | null {
    if (!this.tenant.barberiaActivaId()) {
      return of(valorPorDefecto);
    }
    return null;
  }

  // ── Categorías ──────────────────────────────────────────────────────────

  cargarCategorias(): Observable<CategoriaServicio[]> {
    const sinSede = this.sinSede<CategoriaServicio[]>([]);
    if (sinSede) return sinSede;

    this.cargandoCategorias.set(true);
    this.errorCategorias.set(null);

    return this.http.get<CategoriaServicio[]>(this.categoriasUrl).pipe(
      tap((categorias) => {
        this.categorias.set(Array.isArray(categorias) ? categorias : []);
        this.cargandoCategorias.set(false);
      }),
      catchError((error) => {
        this.cargandoCategorias.set(false);
        this.errorCategorias.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudieron cargar las categorías.'),
        );
        return of([]);
      }),
    );
  }

  crearCategoria(dto: CrearCategoriaDto): Observable<CategoriaServicio> {
    this.guardandoCategoria.set(true);
    this.errorCategorias.set(null);

    return this.http.post<CategoriaServicio>(this.categoriasUrl, dto).pipe(
      tap(() => {
        this.guardandoCategoria.set(false);
        this.cargarCategorias().subscribe();
      }),
      catchError((error) => {
        this.guardandoCategoria.set(false);
        this.errorCategorias.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudo crear la categoría.'),
        );
        return throwError(() => error);
      }),
    );
  }

  actualizarCategoria(id: string, dto: ActualizarCategoriaDto): Observable<CategoriaServicio> {
    this.guardandoCategoria.set(true);
    this.errorCategorias.set(null);

    return this.http.patch<CategoriaServicio>(`${this.categoriasUrl}/${id}`, dto).pipe(
      tap(() => {
        this.guardandoCategoria.set(false);
        this.cargarCategorias().subscribe();
      }),
      catchError((error) => {
        this.guardandoCategoria.set(false);
        this.errorCategorias.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudo actualizar la categoría.'),
        );
        return throwError(() => error);
      }),
    );
  }

  // ── Servicios propios del barbero ───────────────────────────────────────

  cargarMisServicios(): Observable<ServicioBarbero[]> {
    const sinSede = this.sinSede<ServicioBarbero[]>([]);
    if (sinSede) return sinSede;

    this.cargandoMisServicios.set(true);
    this.errorMisServicios.set(null);

    return this.http.get<any[]>(this.misServiciosUrl).pipe(
      tap((servicios) => {
        this.misServicios.set(
          (Array.isArray(servicios) ? servicios : []).map((s) => this.aServicioBarbero(s)),
        );
        this.cargandoMisServicios.set(false);
      }),
      catchError((error) => {
        this.cargandoMisServicios.set(false);
        this.errorMisServicios.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudieron cargar tus servicios.'),
        );
        return of([]);
      }),
    );
  }

  crearServicio(dto: CrearServicioBarberoDto): Observable<ServicioBarbero> {
    this.guardandoServicio.set(true);
    this.errorMisServicios.set(null);

    return this.http.post<ServicioBarbero>(this.misServiciosUrl, dto).pipe(
      tap(() => {
        this.guardandoServicio.set(false);
        this.cargarMisServicios().subscribe();
      }),
      catchError((error) => {
        this.guardandoServicio.set(false);
        this.errorMisServicios.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudo publicar el servicio.'),
        );
        return throwError(() => error);
      }),
    );
  }

  actualizarServicio(id: string, dto: ActualizarServicioBarberoDto): Observable<ServicioBarbero> {
    this.guardandoServicio.set(true);
    this.errorMisServicios.set(null);

    return this.http.patch<ServicioBarbero>(`${this.misServiciosUrl}/${id}`, dto).pipe(
      tap(() => {
        this.guardandoServicio.set(false);
        this.cargarMisServicios().subscribe();
      }),
      catchError((error) => {
        this.guardandoServicio.set(false);
        this.errorMisServicios.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudo actualizar el servicio.'),
        );
        return throwError(() => error);
      }),
    );
  }

  // ── Vitrina del cliente ─────────────────────────────────────────────────

  /**
   * `GET /shops/:shopId/servicios` devuelve las categorías con sus servicios
   * activos y el barbero de cada uno. El backend ya omite las categorías vacías
   * y las inactivas; aquí solo se normaliza el precio, que viaja como `Decimal`
   * serializado (string) y en la plantilla tiene que ser número.
   */
  cargarCatalogo(): Observable<CategoriaDelCatalogo[]> {
    const sinSede = this.sinSede<CategoriaDelCatalogo[]>([]);
    if (sinSede) return sinSede;

    this.cargandoCatalogo.set(true);
    this.errorCatalogo.set(null);

    return this.http.get<any[]>(this.catalogoUrl).pipe(
      tap((categorias) => {
        this.catalogo.set(
          (Array.isArray(categorias) ? categorias : []).map((categoria) => ({
            id: categoria.id,
            nombre: categoria.nombre,
            descripcion: categoria.descripcion ?? null,
            servicios: (categoria.servicios ?? []).map((servicio: any) => ({
              id: servicio.id,
              nombre: servicio.nombre,
              precio: Number(servicio.precio),
              duracionMinutos: Number(servicio.duracionMinutos),
              barbero: {
                id: servicio.barbero?.id ?? '',
                nombre: servicio.barbero?.nombre ?? 'Barbero',
              },
            })),
          })),
        );
        this.cargandoCatalogo.set(false);
      }),
      catchError((error) => {
        this.cargandoCatalogo.set(false);
        this.errorCatalogo.set(
          CatalogoHibridoService.mensajeDeError(error, 'No se pudo cargar el catálogo.'),
        );
        return of([]);
      }),
    );
  }

  private aServicioBarbero(servicio: any): ServicioBarbero {
    return {
      id: servicio.id,
      categoriaId: servicio.categoriaId,
      barberoId: servicio.barberoId,
      nombrePersonalizado: servicio.nombrePersonalizado,
      precio: Number(servicio.precio),
      duracionMinutos: Number(servicio.duracionMinutos),
      activo: servicio.activo !== false,
      categoria: servicio.categoria,
    };
  }
}
