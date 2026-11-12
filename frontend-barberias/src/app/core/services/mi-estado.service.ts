import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { mensajeDeError } from '../utils/error-message.js';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { TenantService } from './tenant.service.js';

/**
 * E4-03/2 · H54 · E3-12/3 · el vínculo del CLIENTE con UNA sede, visto por él.
 *
 * Las dos rutas son las del backend (`MiEstadoController`, `@Roles('CLIENTE')`):
 *
 *  - `GET  /shops/:shopId/membership` → su contador de inasistencias, su
 *    advertencia, su restricción y el estado de su vinculación.
 *  - `POST /shops/:shopId/membership/unlink` → cierra SU vínculo
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
  private readonly apiUrl = `${API_URL}/shops`;
  private readonly tenant = inject(TenantService);

  constructor() {
    this.tenant.registrarPurgadorLocal(() => this.limpiar());
  }

  /** Estado por sede, indexado por `barberiaId`: la tarjeta lo lee de aquí. */
  readonly estados = signal<Record<string, MiEstado>>({});
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private ruta(barberiaId: string): string {
    return `${this.apiUrl}/${barberiaId}/membership`;
  }

  /**
   * `GET /shops/:shopId/membership`.
   *
   * Un 403 `NO_VINCULADO` NO es un error de pantalla: la lista de sedes de la
   * vista puede traer sedes donde el usuario no tiene vínculo de cliente (el
   * listado de `GET /shops` filtra por responsabilidad, no por vínculo), y
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
   * `GET /mi-estado/membresias` · Fase 3 · la versión en lote.
   *
   * Antes la vista pedía `GET /shops/:id/membership` una vez por sede; con el
   * cliente vinculado a varias sedes eso era un bucle de peticiones contra el
   * pool de Neon. Ahora es UNA petición y el backend acota por el usuario del
   * token, así que el resultado no puede mezclar personas.
   *
   * Igual que `cargarEstado`, un fallo no ensucia `error()`: sin membresías la
   * vista simplemente no pinta la tarjeta de fidelización, y un 403 no debe
   * romper la lista de sedes.
   */
  cargarEstados(): Observable<MiEstado[]> {
    this.isLoading.set(true);

    return this.http.get<MiEstado[]>(`${API_URL}/mi-estado/membresias`).pipe(
      tap((estados) => {
        this.isLoading.set(false);
        this.estados.set(
          Object.fromEntries(estados.map((estado) => [estado.barberiaId, estado])),
        );
      }),
      catchError((err: unknown) => {
        this.isLoading.set(false);
        // Un 404 aquí no es «no hay membresías»: es un backend sin el endpoint
        // por lotes (despliegue desincronizado o servidor viejo). La vista sigue
        // funcionando sin fidelización, pero el desarrollador tiene que saberlo.
        if (isDevMode() && err instanceof HttpErrorResponse && err.status === 404) {
          console.warn(
            '[MiEstadoService] GET /mi-estado/membresias respondió 404: el backend no sirve el endpoint por lotes. ' +
              'Comprueba que la versión desplegada incluye la Fase 3. La vista se muestra sin fidelización.',
          );
        }
        return of([] as MiEstado[]);
      }),
    );
  }

  /**
   * `POST /shops/:shopId/membership/unlink`.
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

    return this.http.post<MiDesvinculacion>(`${this.ruta(barberiaId)}/unlink`, {}).pipe(
      tap((resultado) => {
        this.isLoading.set(false);
        this.olvidar(barberiaId);
        this.ultimaDesvinculacion.set(resultado);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(
          mensajeDeError(err, 'No se pudo cerrar tu vinculación con esta barbería'),
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
    this.isLoading.set(false);
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
