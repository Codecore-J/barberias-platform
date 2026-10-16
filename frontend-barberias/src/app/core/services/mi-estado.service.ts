import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

/**
 * E4-03/2 · H54 · E3-12/3 · el vínculo del CLIENTE con UNA sede, visto por él.
 *
 * Las dos rutas son las del backend (`MiEstadoController`, `@Roles('CLIENTE')`):
 *
 *  - `GET  /barberias/:barberiaId/mi-estado` → su contador de inasistencias, su
 *    advertencia, su restricción y el estado de su vinculación.
 *  - `POST /barberias/:barberiaId/mi-estado/desvincular` → cierra SU vínculo
 *    (`DESVINCULADO`), conservando historial y penalización (D20/D21).
 *
 * El backend es la única fuente de verdad: aquí no se decide si alguien puede
 * desvincularse ni si está restringido, solo se pinta y se reenvía lo que
 * responde el contrato D40.
 */
export interface MiEstado {
  barberiaId: string;
  clienteId: string;
  /** `ACTIVO`, `PENDIENTE_APROBACION` o `DESVINCULADO` en ESA sede (D10). */
  estadoVinculacion: string;
  contadorNoPresentado: number;
  estaRestringido: boolean;
  motivoRestriccion: string | null;
  /** `true` con 3 o más inasistencias: la tarjeta muestra la advertencia. */
  advertencia: boolean;
  inasistenciasParaRestriccion: number;
  /** El límite que aplica la sede (5 por defecto, §5.8). */
  limiteInasistencias: number;
  /** Texto listo para mostrar, o `null` si no hay nada que avisar. */
  mensaje: string | null;
}

/** Resultado del cierre del vínculo por decisión del propio cliente. */
export interface MiDesvinculacion {
  barberiaId: string;
  clienteId: string;
  barberiaNombre: string;
  estadoVinculacion: string;
  esBarberiaActiva: boolean;
  /** Vínculos vivos que le quedan: el cupo que D10 le devuelve. */
  vinculacionesVigentes: number;
}

@Injectable({
  providedIn: 'root',
})
export class MiEstadoService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/barberias`;

  /** Estado por sede, indexado por `barberiaId`: la tarjeta lo lee de aquí. */
  readonly estados = signal<Record<string, MiEstado>>({});
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private ruta(barberiaId: string): string {
    return `${this.apiUrl}/${barberiaId}/mi-estado`;
  }

  /**
   * `GET /barberias/:barberiaId/mi-estado`.
   *
   * Un 403 `NO_VINCULADO` NO es un error de pantalla: la lista de sedes de la
   * vista puede traer sedes donde el usuario no tiene vínculo de cliente (el
   * listado de `GET /barberias` filtra por responsabilidad, no por vínculo), y
   * ahí lo correcto es no pintar nada. Por eso el fallo se traduce a `null` y no
   * se ensucia `error()`, que es para lo que el cliente tiene que ver.
   */
  cargarEstado(barberiaId: string): Observable<MiEstado | null> {
    return this.http.get<MiEstado>(this.ruta(barberiaId)).pipe(
      tap((estado) => this.guardar(barberiaId, estado)),
      catchError(() => of(null)),
    );
  }

  /**
   * `POST /barberias/:barberiaId/mi-estado/desvincular`.
   *
   * El cierre es definitivo hasta que el cliente vuelva a introducir el código
   * de acceso (D21), así que se olvida el estado de esa sede —la tarjeta deja de
   * ofrecer el botón— y el resultado trae cuántos vínculos le quedan.
   *
   * Los errores SÍ se propagan y se muestran: un 422 `RESERVAS_EN_CURSO` (tiene
   * citas futuras) o un 409 `ESTADO_INVALIDO` (ya estaba cerrado) son reglas que
   * el cliente tiene que leer, no fallos de red.
   */
  desvincular(barberiaId: string): Observable<MiDesvinculacion> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.post<MiDesvinculacion>(`${this.ruta(barberiaId)}/desvincular`, {}).pipe(
      tap((resultado) => {
        this.isLoading.set(false);
        this.olvidar(barberiaId);
        this.ultimaDesvinculacion.set(resultado);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(
          err.error?.mensaje ||
            err.error?.message ||
            'No se pudo cerrar tu vinculación con esta barbería',
        );
        return throwError(() => err);
      }),
    );
  }

  /** Última desvinculación resuelta: el nombre de la sede y los vínculos que quedan. */
  readonly ultimaDesvinculacion = signal<MiDesvinculacion | null>(null);

  /** Se llama al cerrar sesión: nada del estado de un cliente puede sobrevivir a otro. */
  limpiar(): void {
    this.estados.set({});
    this.ultimaDesvinculacion.set(null);
    this.error.set(null);
  }

  private guardar(barberiaId: string, estado: MiEstado): void {
    this.estados.update((mapa) => ({ ...mapa, [barberiaId]: estado }));
  }

  private olvidar(barberiaId: string): void {
    // Sin `delete` a propósito: el vocabulario del diseño prohíbe nombrar
    // borrados incluso en el cliente, y la guardia de E2-07 lo comprueba.
    this.estados.update((mapa) =>
      Object.fromEntries(Object.entries(mapa).filter(([id]) => id !== barberiaId)),
    );
  }
}
