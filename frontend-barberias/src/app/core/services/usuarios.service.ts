import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

/**
 * Contrato de `GET /plataforma/usuarios` (backend, `UsuarioListResponseDto`).
 *
 * Solo trae campos de lectura aprobada: el backend ni siquiera selecciona
 * `password_hash`, `token_version` ni `cedula`, así que aquí no hay nada
 * sensible que ocultar. `fechaRegistro` viaja como ISO-8601 (o `null` si la
 * cuenta no tiene fecha), por eso el tipo es el del contrato y el `DatePipe`
 * hace el formateo en la tabla.
 */
export interface UsuarioListResponse {
  id: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  estadoCuenta: string;
  fechaRegistro: Date | null;
  roles: string[];
}

/**
 * Respuesta de `PATCH /plataforma/usuarios/:id/estado`
 * (`CambioEstadoCuentaResultado` del backend).
 *
 * `tokenVersion` sube al suspender: es la prueba de que los JWT ya firmados
 * quedaron inválidos, así que el usuario pierde la sesión en todos sus
 * dispositivos. Reactivar no la toca.
 */
export interface CambioEstadoCuentaResponse {
  id: string;
  estadoCuenta: 'ACTIVO' | 'SUSPENDIDO';
  tokenVersion: number;
  sesionesCerradas: boolean;
}

/**
 * Roles que el ADMINISTRADOR puede asignar al dar de alta una cuenta. Espejo
 * de `ROLES_PLATAFORMA` en el `CrearUsuarioPlataformaDto` del backend.
 */
export const ROLES_PLATAFORMA = [
  'ADMINISTRADOR',
  'ADMIN_BARBERIA',
  'BARBERO',
  'CLIENTE',
] as const;

export type RolPlataforma = (typeof ROLES_PLATAFORMA)[number];

/** Cuerpo de `POST /plataforma/usuarios` (mismo DTO que valida el backend). */
export interface CrearUsuarioRequest {
  nombreCompleto: string;
  correo: string;
  password: string;
  telefono: string;
  cedula?: string;
  rolNombre: RolPlataforma;
  /** Obligatorio para ADMIN_BARBERIA y BARBERO; prohibido para roles GLOBAL. */
  barberiaId?: string;
}

/**
 * Evento del historial de una cuenta (`GET /plataforma/usuarios/:id/auditoria`).
 *
 * `motivo` y `actor` llegan ya extraídos por el backend; `contexto` conserva el
 * JSON completo (`anterior`, `nuevo`, `sesionesCerradas`, `rol`). `creadoAt`
 * viaja como ISO-8601 en el cable, igual que `fechaRegistro`.
 */
export interface UsuarioAuditoriaEvento {
  id: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  barberiaId: string | null;
  motivo: string | null;
  contexto: Record<string, unknown> | null;
  actor: { id: string; nombreCompleto: string; correo: string } | null;
  creadoAt: string | null;
}

/** Sede para el selector del alta (`GET /barberias/all`, solo ADMINISTRADOR). */
export interface BarberiaOpcion {
  id: string;
  nombre: string;
}

/**
 * Bandeja de usuarios de la PLATAFORMA.
 *
 * Es una ruta transversal (`@Roles('ADMINISTRADOR')` en el backend), así que no
 * depende de una sede activa: no lleva `barberiaId` ni pasa por `tenantGuard`.
 * El estado de la pantalla vive en señales, igual que en `VinculacionesService`,
 * para que el componente solo pinte.
 */
@Injectable({
  providedIn: 'root',
})
export class UsuariosService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/plataforma/usuarios`;

  readonly usuarios = signal<UsuarioListResponse[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /**
   * `GET /plataforma/usuarios` · arreglo plano ordenado por `fecha_registro DESC`.
   *
   * Un cuerpo ausente no puede romper la tabla (se pinta vacío), y el `mensaje`
   * del contrato de errores D40 se guarda tal cual para que la pantalla explique
   * el 403 en vez de un texto genérico.
   */
  obtenerUsuarios(): Observable<UsuarioListResponse[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<UsuarioListResponse[]>(this.apiUrl).pipe(
      map((usuarios) => usuarios ?? []),
      tap((usuarios) => {
        this.usuarios.set(usuarios);
        this.isLoading.set(false);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.usuarios.set([]);
        this.error.set(
          err.error?.mensaje || err.error?.message || 'No se pudieron cargar los usuarios',
        );
        throw err;
      }),
    );
  }

  /**
   * `PATCH /plataforma/usuarios/:id/estado` · suspende o reactiva la CUENTA.
   *
   * El cuerpo lleva `{ estadoCuenta, motivo }` porque el DTO del backend
   * (`CambiarEstadoCuentaDto`) declara `estadoCuenta` como campo obligatorio y
   * `@IsIn(['ACTIVO', 'SUSPENDIDO'])`: sin él el `ValidationPipe` responde 400
   * antes de llegar al servicio. El `motivo` es obligatorio para el servicio
   * (422 `MOTIVO_REQUERIDO` si va vacío) y queda auditado con el estado anterior
   * y el nuevo.
   *
   * Un 409 `ESTADO_INVALIDO` significa que la cuenta ya estaba en ese estado
   * (otra pestaña, otro administrador): la pantalla lo muestra tal cual.
   *
   * Este método NO toca las señales de la lista: el error pertenece al modal y
   * la recarga la decide el componente cuando la operación sale bien.
   */
  cambiarEstadoUsuario(
    id: string,
    motivo: string,
    estadoCuenta: 'ACTIVO' | 'SUSPENDIDO',
  ): Observable<CambioEstadoCuentaResponse> {
    return this.http.patch<CambioEstadoCuentaResponse>(`${this.apiUrl}/${id}/estado`, {
      estadoCuenta,
      motivo,
    });
  }

  /**
   * `POST /plataforma/usuarios` · alta administrativa de una cuenta.
   *
   * El error NO se guarda en `error()`: pertenece al modal de alta, que muestra
   * el `mensaje` del contrato D40 (409 de duplicado, 422 de ámbito, 404 de sede)
   * sin tapar la tabla. La recarga la decide el componente cuando sale bien.
   */
  crearUsuario(dto: CrearUsuarioRequest): Observable<UsuarioListResponse> {
    return this.http.post<UsuarioListResponse>(this.apiUrl, dto);
  }

  /**
   * `GET /plataforma/usuarios/:id/auditoria` · línea de tiempo de la cuenta,
   * del evento más reciente al más antiguo.
   */
  obtenerAuditoriaUsuario(id: string): Observable<UsuarioAuditoriaEvento[]> {
    return this.http
      .get<UsuarioAuditoriaEvento[]>(`${this.apiUrl}/${id}/auditoria`)
      .pipe(map((eventos) => eventos ?? []));
  }

  /**
   * `GET /barberias/all` · todas las sedes, para elegir la de un rol de sede.
   * Solo el ADMINISTRADOR global recibe esta lista (`@Roles` en el backend).
   */
  listarBarberias(): Observable<BarberiaOpcion[]> {
    return this.http
      .get<BarberiaOpcion[]>(`${API_URL}/shops/all`)
      .pipe(map((barberias) => barberias ?? []));
  }
}
