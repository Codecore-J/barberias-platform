import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, switchMap } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import type { PuertaDeEntrada } from '../utils/invitacion.util.js';

/**
 * E3-12/2 · la invitación de una sede (regla 1.10): lo que el staff comparte.
 * Solo la sirve `GET /barberias/:id/invitacion`, y solo al ADMIN_BARBERIA de esa
 * sede o al ADMINISTRADOR global.
 */
export interface InvitacionSede {
  barberiaId: string;
  nombre: string;
  codigoAcceso: string;
  enlaceUnico: string;
}

/** El vínculo que devuelven las rutas de vinculación: el estado es el de D10. */
export interface VinculoDeCliente {
  id: string;
  usuarioId: string;
  barberiaId: string;
  estadoVinculacion: string;
  esBarberiaActiva: boolean;
}

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
  /**
   * E3-12/2 · la entrada del cliente. La ruta vive bajo `mi-estado` —el espacio
   * del vínculo propio— y es la MISMA lógica blindada que `POST /barberias/vincular`
   * (`vincularCliente`): el límite de D10, la reapertura de H71 y su auditoría
   * son del backend, no de esta pantalla.
   */
  private readonly apiUrlUnirse = `${API_URL}/mi-estado/unirse`;
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
   * Fija la sede activa que eligió el USUARIO (el botón «Seleccionar»).
   *
   * Hallazgo 2 · el cambio de manos lo autoriza y registra el backend: el
   * estado local —señal y `localStorage`— solo se toca en el `tap`, es decir,
   * tras el 200 de `PATCH /barberias/:id/seleccionar`. Si el backend falla
   * (403 de un vínculo `PENDIENTE_APROBACION`, 404 de una sede sin vínculo o
   * caída de red) la sede anterior sigue siendo la activa, el mensaje del
   * contrato D40 queda en `error()` y el error se propaga para que la pantalla
   * decida qué hacer con él.
   */
  seleccionarBarberia(barberiaId: string): Observable<any> {
    this.isLoading.set(true);
    this.error.set(null);
    return this.pedirSeleccion(barberiaId).pipe(
      tap(() => {
        this.fijarLocalTrasBackend(barberiaId);
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
   * `PATCH /barberias/:id/seleccionar`. La ÚNICA puerta del servicio para que
   * una sede pase a ser activa: la llaman el botón del usuario y el auto-pick
   * de `sincronizarSedeActiva`, que por eso ya no decide nada por su cuenta.
   */
  private pedirSeleccion(barberiaId: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${barberiaId}/seleccionar`, {});
  }

  /**
   * Tras el 200 del backend, la sede de la lista local pasa a ser la activa.
   * Si no está en la lista no hay objeto completo que cachear y no se fija
   * nada —los dos llamadores la tienen en la lista (la tarjeta, y la recarga
   * previa de `crearBarberia`), así que esto es solo defensivo—.
   */
  private fijarLocalTrasBackend(barberiaId: string): void {
    const barberia = this.barberiasVinculadas().find((b) => b.id === barberiaId);
    if (barberia) {
      this.setBarberiaActiva(barberia);
    }
  }

  /**
   * Vincula al usuario con una barbería usando un código de acceso de 8 caracteres.
   *
   * E3-12/2: el modal de vinculación pasa a ser un caso particular de `unirse`
   * —un código es una de las dos formas de nombrar la misma puerta de entrada—
   * para que no existan en el navegador dos caminos distintos hacia el mismo
   * vínculo, con dos manejos de error que podrían divergir.
   */
  vincularBarberia(codigoAcceso: string): Observable<VinculoDeCliente> {
    return this.unirsePorInvitacion({ codigoAcceso });
  }

  /**
   * E3-12/2 · la invitación de una sede (regla 1.10).
   *
   * El error queda en `error()` con el mensaje del contrato D40 y se propaga: la
   * pantalla del panel decide si muestra el aviso o simplemente deja el bloque
   * sin código.
   */
  obtenerInvitacion(barberiaId: string): Observable<InvitacionSede> {
    this.error.set(null);
    return this.http.get<InvitacionSede>(`${this.apiUrl}/${barberiaId}/invitacion`).pipe(
      catchError((err) => {
        this.error.set(
          err.error?.mensaje || err.error?.message || 'No se pudo obtener la invitación de la sede',
        );
        throw err;
      }),
    );
  }

  /**
   * E3-12/2 · el cliente ENTRA en una sede con la puerta que traiga: el código
   * que le dictaron o el enlace único de su QR.
   *
   * Tras el 200 se recarga la lista de sedes —la del vínculo propio, `GET
   * /mi-estado/barberias`— porque la tarjeta que corresponde a la sede nueva
   * todavía no está pintada. El estado del vínculo (`ACTIVO` o
   * `PENDIENTE_APROBACION`) lo decide el backend con la regla de D10 y la
   * pantalla solo lo cuenta.
   */
  unirsePorInvitacion(puerta: PuertaDeEntrada): Observable<VinculoDeCliente> {
    this.isLoading.set(true);
    this.error.set(null);
    return this.http.post<VinculoDeCliente>(this.apiUrlUnirse, puerta).pipe(
      tap(() => {
        this.isLoading.set(false);
        this.cargarBarberias().subscribe();
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.mensaje || err.error?.message || 'No se pudo completar la unión');
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
          this.seleccionarBarberia((nuevaBarberia as any).id || (nuevaBarberia as any).data?.id).subscribe({
            // Si el backend rechazara la selección, el mensaje ya queda en
            // `error()` y la pantalla de creación lo muestra; no se propaga.
            error: () => undefined,
          });
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
   * en el acto.
   *
   * Hallazgo 2 · y la purga no era lo único que decidía el navegador: antes de
   * este cambio, la sustituta se fijaba en local (caché → `esBarberiaActiva` →
   * la primera) sin preguntarle a nadie, así que `es_barberia_activa` en la
   * base podía no coincidir con la sede que operaba el navegador. Ahora las dos
   * ramas tienen la misma dueña: la que ya era activa y SIGUE en la lista solo
   * refresca su objeto cacheado (no hubo cambio de manos), y toda sede que
   * PASA a ser activa lo decide el backend vía `pedirSeleccion`.
   *
   * Ojo con el orden de los operadores: esto vive en un `tap`, así que un fallo
   * de RED no llega hasta aquí y no purga nada. Una carga que sí responde —aunque
   * responda vacío o sin la sede— sí purga, y eso es lo que se quiere.
   */
  private sincronizarSedeActiva(barberias: BarberiaResumen[]): void {
    const referencia = this.barberiaActiva()?.id ?? localStorage.getItem(this.storageKey);
    const conservada = referencia ? (barberias.find((b) => b.id === referencia) ?? null) : null;

    // H74 · la sede fijada (señal o caché) solo sigue siendo la activa si sigue EN la lista.
    if (referencia && !conservada) {
      this.setBarberiaActiva(null);
    }

    // Misma sede que la actual: solo se refresca el objeto cacheado (la lista
    // trae datos más frescos que los de la caché). No hay cambio de manos, así
    // que no vuelve a pasar por `/seleccionar`: la eligió el usuario y el
    // backend la registró cuando la fijó.
    if (conservada && conservada.id === this.barberiaActiva()?.id) {
      this.setBarberiaActiva(conservada);
      return;
    }

    // Rama del cambio de manos: la sustituta (la que el backend marcó activa
    // o, si ninguna lo está —D10 solo apaga la fila que se cierra—, la primera).
    const candidata =
      conservada ??
      barberias.find((b) => b.esBarberiaActiva) ??
      barberias[0] ??
      null;

    if (!candidata) {
      return;
    }

    // Hallazgo 2 · una sede que PASA a ser activa la decide el backend. Hasta
    // el 200 no hay sede activa (el guard manda al hub de sedes), y un 403/404
    // —un vínculo que ya no opera— o una caída de red no fijan NADA: el
    // mensaje queda en `error()` y la lista de sedes se conserva igual.
    this.pedirSeleccion(candidata.id)
      .pipe(
        tap(() => this.setBarberiaActiva(candidata)),
        catchError((err) => {
          this.error.set(err.error?.message || 'No se pudo seleccionar la sede activa');
          return of(null);
        }),
      )
      .subscribe();
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
