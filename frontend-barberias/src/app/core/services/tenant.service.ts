import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  tap,
  catchError,
  of,
  map,
  switchMap,
  throwError,
  shareReplay,
  finalize,
} from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import type { PuertaDeEntrada } from '../utils/invitacion.util.js';
import { mensajeDeError } from '../utils/error-message.js';

/**
 * E3-12/2 · la invitación de una sede (regla 1.10): lo que el staff comparte.
 * Solo la sirve `GET /shops/:shopId/invitation`, y solo al ADMIN_BARBERIA de esa
 * sede o al ADMINISTRADOR global.
 */
export interface InvitacionSede {
  barberiaId: string;
  nombre: string;
  codigoAcceso: string;
  enlaceUnico: string;
}

/**
 * E3-13 · lo que se edita de una sede ya creada (D26/D27).
 *
 * `nombre` y `estado` NO están: el backend los rechaza con 422
 * (`NOMBRE_REQUIERE_SOLICITUD` / `ESTADO_NO_EDITABLE`) porque el nombre solo
 * cambia por solicitud aprobada y el estado tiene su propia ruta. `passwordActual`
 * viaja solo cuando cambia el teléfono: es la exigencia de D27.
 */
export interface ActualizarBarberiaRequest {
  descripcion?: string;
  ubicacion?: string;
  logoUrl?: string;
  telefono?: string;
  passwordActual?: string;
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
  /** E3-13 · editable desde `PATCH /shops/:shopId` (los tres últimos campos). */
  logoUrl?: string | null;
  telefono: string;
  ubicacion: string;
  /**
   * H72 · `codigoAcceso` y `enlaceUnico` solo los sirve `GET /shops` (la
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
  private readonly apiUrl = `${API_URL}/shops`;
  /**
   * H72 · las sedes del CLIENTE son las de su VÍNCULO, no las que responsabiliza.
   * `GET /shops` filtra por `responsableId`, así que a un cliente puro le
   * devuelve `[]` aunque tenga vínculos en `cliente_barberias`.
   */
  private readonly apiUrlMisSedes = `${API_URL}/mi-estado/barberias`;
  /**
   * E3-12/2 · la entrada del cliente. La ruta vive bajo `mi-estado` —el espacio
   * del vínculo propio— y es la MISMA lógica blindada que `POST /shops/link`
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

  /** Los servicios de dominio registran aquí la purga de sus cachés de sede. */
  private readonly purgadoresEstadoLocal = new Set<() => void>();

  /**
   * Fase 2 · caché en memoria del listado de sedes.
   *
   * Antes, cada montaje del layout, cada pantalla y cada guard disparaban su
   * propio `GET /shops` (y su `GET /mi-estado/barberias` cuando la lista venía
   * vacía): el mismo dato se pedía tres o cuatro veces por navegación. Aquí el
   * listado resuelto se guarda como snapshot y se devuelve tal cual a quien lo
   * pida después, hasta que algo lo invalide.
   */
  private sedesResueltas: BarberiaResumen[] | null = null;

  /**
   * Fase 2 · la petición EN VUELO, compartida con `shareReplay`.
   *
   * `refCount: true` cierra la fuente en cuanto se suelta la última
   * suscripción, así que la ráfaga de suscripciones simultáneas —cabecera,
   * guard y pantalla montando en el mismo instante— comparte UNA sola
   * respuesta. El valor sobrevive entre navegaciones por `sedesResueltas`, no
   * por el buffer del `shareReplay`.
   */
  private sedesEnVuelo$: Observable<BarberiaResumen[]> | null = null;

  /**
   * Fase 2 · el auto-pick ya tiene un `PATCH /select` en el aire.
   *
   * Dos suscriptores simultáneos reciben la MISMA lista y ambos ejecutan
   * `sincronizarSedeActiva`; sin esta guardia, mientras el backend no contesta
   * la sede sigue sin estar fijada y se pediría el cambio dos veces.
   */
  private seleccionPendienteId: string | null = null;

  /**
   * Fase 2 · la invitación de cada sede, ya resuelta.
   *
   * El bloque «Invitación de la Sede» la pedía en CADA montaje de `/barberias`:
   * entrar, salir y volver eran tres `GET /shops/:id/invitation` para el mismo
   * código que no había cambiado. La entrada es por sede porque la invitación
   * es de la sede, no del usuario, y solo se descarta cuando algo la invalida
   * (`invalidarSedes`), nunca por tiempo.
   */
  private readonly invitacionesResueltas = new Map<string, InvitacionSede>();

  /**
   * Fase 2 · la invitación EN VUELO por sede, compartida con `shareReplay`.
   *
   * Dos montajes simultáneos de la misma pantalla —o el guard y el bloque
   * montando a la vez— esperan esta misma petición en lugar de abrir dos.
   */
  private readonly invitacionesEnVuelo = new Map<string, Observable<InvitacionSede>>();

  /**
   * Fase 2b · la generación de los datos de sede.
   *
   * El snapshot se escribe cuando LLEGA la respuesta, y una invalidación puede
   * ocurrir con la petición en el aire: sin este contador, esa respuesta vieja
   * repuebla la caché y el siguiente consumidor recibe datos anteriores al
   * cambio. Cada petición anota la generación con la que salió y solo escribe
   * si sigue siendo la vigente; al suscriptor se le entrega igual, así que a
   * nadie se le deja colgado.
   */
  private generacion = 0;

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
   * H72 · dos orígenes, un solo resultado. `GET /shops` responde por
   * RESPONSABILIDAD (el dueño, el admin de sede y el barbero que entró por rol);
   * el CLIENTE responde por VÍNCULO, y esa lista la sirve
   * `GET /mi-estado/barberias`. Se pregunta primero por responsabilidad y, si
   * viene vacía, por vínculo: así el selector de sede funciona para los cuatro
   * roles sin que este servicio tenga que adivinar el rol del token (y sin la
   * carrera de leer `authState()` antes de que `/auth/me` haya respondido).
   *
   * D05 · al ADMINISTRADOR global `GET /shops` le devuelve TODAS las sedes
   * activas de la plataforma (el backend resuelve su alcance), así que el mismo
   * camino sirve sin una rama por rol en el navegador.
   *
   * `autoSeleccionar: false` sirve para el superadmin: su pantalla de entrada es
   * el hub y la sede la elige él, en lugar de quedar anclado a la primera de la
   * lista por un `PATCH /select` que nadie pidió.
   */
  cargarBarberias(
    opciones: { autoSeleccionar?: boolean; forzarRecarga?: boolean } = {},
  ): Observable<BarberiaResumen[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.sedesCompartidas(opciones.forzarRecarga === true).pipe(
      tap((barberias: BarberiaResumen[]) => {
        this.barberiasVinculadas.set(barberias);
        this.isLoading.set(false);
        this.sincronizarSedeActiva(barberias, opciones.autoSeleccionar !== false);
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al cargar barberías'));
        return of([]);
      }),
    );
  }

  /**
   * Fase 2 · el stream COMPARTIDO del listado de sedes.
   *
   * Resuelve en este orden: snapshot en memoria → petición en vuelo → petición
   * nueva. El `tap` que escribe el snapshot va ANTES del `shareReplay` para que
   * se ejecute una sola vez por respuesta, mientras que el `tap` de
   * `cargarBarberias` (que sincroniza la sede activa y las señales) va después,
   * de modo que cada suscriptor conserve su propio `autoSeleccionar` sin volver
   * a pedir nada al backend.
   *
   * Un fallo NO se cachea: el error se propaga al suscriptor, que decide qué
   * pintar, y `sedesResueltas` sigue vacío para que el siguiente intento vuelva
   * a preguntar. Sin esto, una caída puntual de red dejaría la lista vacía en
   * memoria hasta el recargado de la página.
   */
  private sedesCompartidas(forzarRecarga: boolean): Observable<BarberiaResumen[]> {
    if (forzarRecarga) this.invalidarSedes();

    if (this.sedesResueltas) return of(this.sedesResueltas);

    if (!this.sedesEnVuelo$) {
      const generacionAlPedir = this.generacion;
      this.sedesEnVuelo$ = this.solicitarSedes().pipe(
        tap((sedes) => {
          // Fase 2b · si la invalidación llegó mientras la respuesta viajaba,
          // se entrega al suscriptor pero NO se cachea.
          if (this.generacion === generacionAlPedir) this.sedesResueltas = sedes;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }

    return this.sedesEnVuelo$;
  }

  /**
   * Fase 2 · descarta la caché en memoria del listado de sedes.
   *
   * La llaman los flujos que cambian los vínculos o la propia sede —unirse,
   * crear, desvincular, editar, cerrar sesión—: el snapshot deja de representar
   * lo que hay en el backend y la próxima carga debe preguntarlo otra vez.
   */
  invalidarSedes(): void {
    // Fase 2b · las peticiones que ya salieron quedan marcadas como obsoletas:
    // podrán entregarse a quien las espera, pero no escribir la caché.
    this.generacion += 1;
    this.sedesResueltas = null;
    this.sedesEnVuelo$ = null;
    // Fase 2 · la invitación es un dato de la SEDE: si la sede cambió (edición,
    // reasignación, cierre de sesión) el código cacheado ya no sirve. Una
    // petición que ya estaba en el aire puede repoblar el snapshot al llegar;
    // es el mismo compromiso que asume el listado de sedes.
    this.invitacionesResueltas.clear();
    this.invitacionesEnVuelo.clear();
  }

  /** Las dos rutas de H72 (`/shops` y, si viene vacía, `/mi-estado/barberias`). */
  private solicitarSedes(): Observable<BarberiaResumen[]> {
    return this.http.get<any>(this.apiUrl).pipe(
      map((res) => this.normalizar(res)),
      switchMap((sedesPorResponsabilidad) =>
        sedesPorResponsabilidad.length > 0 ? of(sedesPorResponsabilidad) : this.cargarSedesVinculadas(),
      ),
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
   * tras el 200 de `PATCH /shops/:shopId/select`. Si el backend falla
   * (403 de un vínculo `PENDIENTE_APROBACION`, 404 de una sede sin vínculo o
   * caída de red) la sede anterior sigue siendo la activa, el mensaje del
   * contrato D40 queda en `error()` y el error se propaga para que la pantalla
   * decida qué hacer con él.
   */
  seleccionarBarberia(barberiaId: string): Observable<any> {
    return this.cambiarSedeActiva(barberiaId);
  }

  /**
   * Cambia el contexto de sede solo después de que el backend autorice la
   * selección. Al confirmar una sede distinta se purgan los datos compartidos
   * en memoria antes de guardar la nueva sede activa.
   */
  cambiarSedeActiva(shopId: string): Observable<any> {
    const idSolicitado = shopId?.trim();
    if (!idSolicitado) {
      return throwError(() => new Error('La sede solicitada no es válida.'));
    }

    if (this.barberiaActivaId() === idSolicitado) return of(null);

    this.isLoading.set(true);
    this.error.set(null);

    const sedes$ = this.barberiasVinculadas().length > 0
      ? of(this.barberiasVinculadas())
      : this.cargarBarberias({ autoSeleccionar: false });

    return sedes$.pipe(
      switchMap((sedes) => {
        const sede = sedes.find((barberia) => barberia.id === idSolicitado);
        if (!sede) {
          return throwError(() => new Error('La sede no está disponible para esta cuenta.'));
        }

        return this.pedirSeleccion(idSolicitado).pipe(
          tap(() => {
            this.purgarEstadoLocal();
            this.guardarSedeActiva(sede);
          }),
        );
      }),
      tap(() => this.isLoading.set(false)),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'No se pudo seleccionar la sede'));
        throw err;
      }),
    );
  }

  /**
   * `PATCH /shops/:shopId/select`. La ÚNICA puerta del servicio para que
   * una sede pase a ser activa: la llaman el botón del usuario y el auto-pick
   * de `sincronizarSedeActiva`, que por eso ya no decide nada por su cuenta.
   */
  private pedirSeleccion(barberiaId: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${barberiaId}/select`, {});
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
   *
   * Fase 2 · resuelve igual que el listado de sedes: snapshot en memoria →
   * petición en vuelo → petición nueva. Volver a `/barberias` ya no vuelve a
   * pedir el mismo código de la misma sede.
   */
  obtenerInvitacion(
    barberiaId: string,
    opciones: { forzarRecarga?: boolean } = {},
  ): Observable<InvitacionSede> {
    if (opciones.forzarRecarga === true) {
      this.invitacionesResueltas.delete(barberiaId);
    }

    const cacheada = this.invitacionesResueltas.get(barberiaId);
    if (cacheada) return of(cacheada);

    const enVuelo = this.invitacionesEnVuelo.get(barberiaId);
    if (enVuelo) return enVuelo;

    this.error.set(null);

    const generacionAlPedir = this.generacion;

    const peticion$ = this.http
      .get<InvitacionSede>(`${this.apiUrl}/${barberiaId}/invitation`)
      .pipe(
        tap((invitacion) => {
          // Fase 2b · misma regla que el listado: respuesta vieja, caché intacta.
          if (this.generacion === generacionAlPedir) {
            this.invitacionesResueltas.set(barberiaId, invitacion);
          }
        }),
        catchError((err) => {
          // Un fallo NO se cachea: el reintento tiene que volver a preguntar.
          this.invitacionesResueltas.delete(barberiaId);
          this.error.set(
            mensajeDeError(err, 'No se pudo obtener la invitación de la sede'),
          );
          throw err;
        }),
        finalize(() => this.invitacionesEnVuelo.delete(barberiaId)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    this.invitacionesEnVuelo.set(barberiaId, peticion$);
    return peticion$;
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
        // Fase 2 · hay un vínculo nuevo: el snapshot se descarta antes de
        // recargar, o la recarga devolvería la lista anterior sin la sede nueva.
        this.invalidarSedes();
        this.cargarBarberias().subscribe();
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'No se pudo completar la unión'));
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
        // Recargar la lista y seleccionarla (sin el snapshot anterior, que no
        // conoce la sede recién creada).
        this.invalidarSedes();
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
        this.error.set(mensajeDeError(err, 'Error al crear la barbería'));
        throw err;
      }),
    );
  }

  /**
   * E3-13 · edición directa de la sede (`PATCH /shops/:shopId`).
   *
   * Solo `descripcion`, `ubicacion`, `logoUrl` y `telefono`; el teléfono exige
   * `passwordActual` y el backend responde 422 `PASSWORD_REQUERIDA` si falta. La
   * respuesta se escribe en la lista y en la sede activa en lugar de recargar:
   * el `PATCH` devuelve la sede completa, así que otra petición solo para ver los
   * datos que ya vienen en el cuerpo dejaría la pantalla parpadeando.
   */
  actualizarBarberia(
    barberiaId: string,
    dto: ActualizarBarberiaRequest,
  ): Observable<BarberiaResumen> {
    return this.http.patch<BarberiaResumen>(`${this.apiUrl}/${barberiaId}`, dto).pipe(
      tap((actualizada) => {
        // Fase 2 · la sede cambió: el snapshot cacheado ya no la representa.
        this.invalidarSedes();
        this.barberiasVinculadas.update((lista) =>
          lista.map((sede) =>
            sede.id === barberiaId ? { ...sede, ...actualizada, id: sede.id } : sede,
          ),
        );

        const activa = this.barberiaActiva();
        if (activa?.id === barberiaId) {
          this.setBarberiaActiva({ ...activa, ...actualizada, id: activa.id });
        }
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
  private sincronizarSedeActiva(barberias: BarberiaResumen[], autoSeleccionar = true): void {
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

    // El superadmin elige su contexto en el hub: sin selección previa no se
    // autoasigna la primera sede, porque entrar a auditar «la que toque» no es
    // una decisión suya. La purga y el refresco de arriba ya se aplicaron.
    if (!autoSeleccionar) {
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

    // Fase 2 · dos suscriptores de la MISMA respuesta (la cabecera y la
    // pantalla) llegan aquí a la vez con la sede aún sin fijar: el segundo no
    // puede pedir un cambio de manos que el primero ya está pidiendo.
    if (this.seleccionPendienteId) {
      return;
    }

    // Hallazgo 2 · una sede que PASA a ser activa la decide el backend. Hasta
    // el 200 no hay sede activa (el guard manda al hub de sedes), y un 403/404
    // —un vínculo que ya no opera— o una caída de red no fijan NADA: el
    // mensaje queda en `error()` y la lista de sedes se conserva igual.
    this.seleccionPendienteId = candidata.id;
    this.pedirSeleccion(candidata.id)
      .pipe(
        tap(() => this.setBarberiaActiva(candidata)),
        catchError((err) => {
          this.error.set(mensajeDeError(err, 'No se pudo seleccionar la sede activa'));
          return of(null);
        }),
        finalize(() => {
          this.seleccionPendienteId = null;
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
    // Fase 2 · el snapshot todavía contiene la sede purgada: la recarga que
    // sigue al cierre del vínculo tiene que volver a preguntar, no repetirla.
    this.invalidarSedes();
    this.barberiasVinculadas.update((lista) => lista.filter((b) => b.id !== barberiaId));

    if (this.barberiaActivaId() === barberiaId) {
      this.setBarberiaActiva(null);
    }
  }

  setBarberiaActiva(barberia: BarberiaResumen | null) {
    if (this.barberiaActivaId() !== (barberia?.id ?? null)) {
      this.purgarEstadoLocal();
    }
    this.guardarSedeActiva(barberia);
  }

  /** Registra el reset de señales en un servicio con caché de sede. */
  registrarPurgadorLocal(purgador: () => void): void {
    this.purgadoresEstadoLocal.add(purgador);
  }

  private purgarEstadoLocal(): void {
    for (const purgar of this.purgadoresEstadoLocal) purgar();
    this.error.set(null);
  }

  private guardarSedeActiva(barberia: BarberiaResumen | null): void {
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
    this.invalidarSedes();
    this.seleccionPendienteId = null;
    this.purgarEstadoLocal();
    this.guardarSedeActiva(null);
    this.barberiasVinculadas.set([]);
  }
}
