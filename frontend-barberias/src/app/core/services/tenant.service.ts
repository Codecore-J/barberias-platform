import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, switchMap } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';

export interface BarberiaResumen {
  id: string;
  nombre: string;
  descripcion?: string | null;
  telefono: string;
  ubicacion: string;
  /**
   * H72 · `codigoAcceso` y `enlaceUnico` solo los sirve `GET /barberias` (la
   * sede que uno RESPONSABILIZA): son la puerta de entrada y quien ya está
   * dentro no los necesita. El listado del CLIENTE
   * (`GET /mi-estado/barberias`) no los trae, así que la tarjeta no puede
   * depender de ellos.
   */
  codigoAcceso?: string;
  enlaceUnico?: string;
  responsableId: string;
  estado: string;
  esBarberiaActiva?: boolean;
  /** D10 · `ACTIVO`, `PENDIENTE_APROBACION` o `DESVINCULADO`. */
  estadoVinculacion?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/barberias`;
  /**
   * H72 · las sedes del CLIENTE son las de su VÍNCULO, no las que responsabiliza.
   * `GET /barberias` filtra por `responsableId`, así que a un cliente puro le
   * devuelve `[]` aunque tenga vínculos en `cliente_barberias`.
   */
  private readonly apiUrlMisSedes = `${API_URL}/mi-estado/barberias`;
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
   * Carga las barberías del usuario y determina la activa.
   *
   * H72 · dos orígenes, un solo resultado. `GET /barberias` responde por
   * RESPONSABILIDAD (el dueño, el admin de sede y el barbero que entró por rol);
   * el CLIENTE responde por VÍNCULO, y esa lista la sirve
   * `GET /mi-estado/barberias`. Se pregunta primero por responsabilidad y, si
   * viene vacía, por vínculo: así el selector de sede funciona para los cuatro
   * roles sin que este servicio tenga que adivinar el rol del token (y sin la
   * carrera de leer `authState()` antes de que `/auth/me` haya respondido).
   */
  cargarBarberias(): Observable<BarberiaResumen[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(this.apiUrl).pipe(
      map((res) => this.normalizar(res)),
      switchMap((sedesPorResponsabilidad) =>
        sedesPorResponsabilidad.length > 0 ? of(sedesPorResponsabilidad) : this.cargarSedesVinculadas(),
      ),
      tap((barberias: BarberiaResumen[]) => {
        this.barberiasVinculadas.set(barberias);
        this.isLoading.set(false);
        this.sincronizarSedeActiva(barberias);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Error al cargar barberías');
        return of([]);
      }),
    );
  }

  /**
   * `GET /mi-estado/barberias` · las sedes del vínculo propio (H72), ya filtradas
   * por el backend: solo vínculos `ACTIVO` o `PENDIENTE_APROBACION` y solo sedes
   * activas. Un 403 (el usuario no es CLIENTE) no es un error de pantalla: es que
   * no hay vínculos que listar, así que se traduce a lista vacía.
   */
  private cargarSedesVinculadas(): Observable<BarberiaResumen[]> {
    return this.http.get<any>(this.apiUrlMisSedes).pipe(
      map((res) => this.normalizar(res)),
      catchError(() => of([])),
    );
  }

  /** El backend puede envolver la lista (`{ data: [] }`) o devolverla directa. */
  private normalizar(res: any): BarberiaResumen[] {
    return Array.isArray(res) ? res : (res?.data ?? []);
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
      }),
    );
  }

  /**
   * H74 · la sede activa tiene que estar EN la lista.
   *
   * La regla anterior solo fijaba la activa cuando encontraba una sede, así que
   * con la lista VACÍA no pasaba nada: la señal y la caché de `localStorage`
   * conservaban la sede anterior y el usuario quedaba anclado a una sede
   * fantasma —la cabecera la seguía anunciando y `authInterceptor` seguía
   * mandando su `x-barberia-id`, con el backend respondiendo sobre una sede a la
   * que ya no pertenece—.
   *
   * Si la sede fijada (o la que dejó la caché) ya no está en la lista, se purga
   * en el acto; después se elige la siguiente: la que el backend marcó activa o,
   * si ninguna lo está (D10 solo apaga la fila que se cierra), la primera.
   *
   * Ojo con el orden de los operadores: esto vive en un `tap`, así que un fallo
   * de RED no llega hasta aquí y no purga nada. Una carga que sí responde —aunque
   * responda vacío o sin la sede— sí purga, y eso es lo que se quiere.
   */
  private sincronizarSedeActiva(barberias: BarberiaResumen[]): void {
    const guardadaId = localStorage.getItem(this.storageKey);
    const referencia = this.barberiaActiva()?.id ?? guardadaId;

    if (referencia && !barberias.some((b) => b.id === referencia)) {
      this.setBarberiaActiva(null);
    }

    const activa =
      barberias.find((b) => b.id === (this.barberiaActiva()?.id ?? guardadaId)) ??
      barberias.find((b) => b.esBarberiaActiva) ??
      barberias[0] ??
      null;

    if (activa) {
      this.setBarberiaActiva(activa);
    }
  }

  /**
   * H74 · saca UNA sede de la sesión sin esperar a que vuelva la lista.
   *
   * Lo llama el flujo de desvinculación: la tarjeta desaparece en el clic y, si
   * la sede purgada era la ACTIVA, también se va la señal y la caché (si no,
   * `authInterceptor` seguiría mandando `x-barberia-id` de un vínculo ya
   * cerrado hasta que llegara la recarga). Si quedan otras sedes, la recarga
   * inmediatamente posterior elige la siguiente.
   */
  purgarBarberia(barberiaId: string): void {
    this.barberiasVinculadas.update((lista) => lista.filter((b) => b.id !== barberiaId));

    if (this.barberiaActivaId() === barberiaId) {
      this.setBarberiaActiva(null);
    }
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
