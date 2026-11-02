import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

/**
 * E4-03 · lista negra LOCAL de la sede (D48).
 *
 * La penalización por inasistencias es de cada barbería: estas dos rutas no
 * tocan `usuarios.estado_cuenta` —suspender la cuenta es de la plataforma— y el
 * backend vuelve a exigir la pertenencia a la sede (403) aunque el guard de la
 * ruta ya haya filtrado el rol.
 *
 * `vinculadoDesde` es el alta del VÍNCULO con esta sede, no la fecha de la
 * restricción: la fila no guarda esa marca, así que la pantalla no la inventa.
 */
export interface ClienteRestringido {
  clienteId: string;
  nombreCompleto: string;
  correo: string;
  telefono: string | null;
  contadorNoPresentado: number;
  motivoRestriccion: string | null;
  vinculadoDesde: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class ClientesRestringidosService {
  private readonly http = inject(HttpClient);

  readonly clientes = signal<ClienteRestringido[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  /** `GET /shops/:shopId/restricted-clients` · solo las filas restringidas. */
  cargar(barberiaId: string): Observable<ClienteRestringido[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http
      .get<ClienteRestringido[]>(`${API_URL}/shops/${barberiaId}/restricted-clients`)
      .pipe(
        tap((filas) => {
          this.clientes.set(Array.isArray(filas) ? filas : []);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          this.isLoading.set(false);
          this.clientes.set([]);
          this.error.set(
            err.error?.mensaje ||
              err.error?.message ||
              'No se pudieron cargar los clientes restringidos',
          );
          throw err;
        }),
      );
  }

  /**
   * `POST /shops/:shopId/restricted-clients/:clientId/reactivate` · levanta la
   * restricción de ESA sede y reinicia su contador. El cliente sale de la lista
   * en el acto, sin recargar.
   */
  reactivar(barberiaId: string, clienteId: string): Observable<unknown> {
    this.error.set(null);

    return this.http
      .post(
        `${API_URL}/shops/${barberiaId}/restricted-clients/${clienteId}/reactivate`,
        {},
      )
      .pipe(
        tap(() => {
          this.clientes.update((lista) => lista.filter((fila) => fila.clienteId !== clienteId));
        }),
        catchError((err) => {
          this.error.set(
            err.error?.mensaje || err.error?.message || 'No se pudo reactivar al cliente',
          );
          throw err;
        }),
      );
  }
}
