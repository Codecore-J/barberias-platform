import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map, switchMap, throwError } from 'rxjs';
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

export interface ActualizarBarberiaRequest {
  descripcion?: string;
  ubicacion?: string;
  logoUrl?: string;
  telefono?: string;
  passwordActual?: string;
}

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
  logoUrl?: string | null;
  telefono: string;
  ubicacion: string;
  codigoAcceso?: string;
  enlaceUnico?: string;
  responsableId: string;
  estado: string;
  estadoVinculacion?: string;
}

/** Indica si una sede es la activa actualmente en la sesión */
export interface SedeActivaContext {
  esSedePropia: boolean; // true si la sede pertenece al usuario por responsabilidad
  esSedeVinculada: boolean; // true si tiene vínculo cliente
  esAdminGlobal: boolean; // true si es ADMINISTRADOR global
}

/** Servicio de Tenant (sesión de sede) - E3-12/2 · H72 · D05
 * Gestiona el contexto de sede activo para el usuario.
 * El ADMINISTRADOR global ve TODAS las sedes y puede operar transversalmente.
 */

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/shops`;
  /** GET /mi-estado/barberias - sedes del vínculo propio (H72) */
  private readonly apiUrlMisSedes = `${API_URL}/mi-estado/barberias`;
  private readonly storageKey = 'active_barberia_id';

  // Signals reactivos para el tenant
  readonly barberiaActiva = signal<BarberiaResumen | null>(null);
  readonly barberiasVinculadas = signal<BarberiaResumen[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Track if user is global admin for UI logic
  readonly esAdminGlobal = computed(() => {
    return false; // Placeholder - se evalúa en el componente
  });

  // Computeds útiles
  readonly tieneBarberiaActiva = computed(() => !!this.barberiaActiva());
  readonly barberiaActivaId = computed(() => this.barberiaActiva()?.id ?? null);
  readonly nombreBarberiaActiva = computed(
    () => this.barberiaActiva()?.nombre ?? 'Sin Barbería Seleccionada',
  );

  readonly esSedePropia = computed(() => {
    const user = this.authService?.authState()?.user;
    if (!user?.roles?.includes('ADMINISTRADOR')) {
      return this.barberiaActiva()?.responsableId === this.barberiaActivaId();
    }
    // Admin global siempre tiene acceso transversal
    return true;
  });

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

  /** Carga las barberías del usuario y determina la activa.
   * Dos orígenes, un solo resultado:
   * - `GET /shops` responde por RESPONSABILIDAD (el dueño, admin de sede, barbero)
   * - El CLIENTE responde por VÍNCULO (`GET /mi-estado/barberias`)
   * - El ADMINISTRADOR global `GET /shops` le devuelve TODAS las sedes activas
   * Flujo: primero intenta por responsabilidad, si queda vacío busca por vínculo.
   * Para admin global, `/shops` ya trae todo, así que no necesita rama especial.
   */
  cargarBarberias(): Observable<BarberiaResumen[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<any>(this.apiUrl).pipe(
      map((res) => this.normalizar(res)),
      switchMap((sedesPorResponsabilidad) => {
        // Si vienen sedes por responsabilidad, úsenlas
        if (sedesPorResponsabilidad.length > 0) {
          this.barberiasVinculadas.set(sedesPorResponsabilidad);
          this.isLoading.set(false);
          this.sincronizarSedeActiva(sedesPorResponsabilidad, true);
          return of(sedesPorResponsabilidad);
        }
        // Si no, caemos al vínculo (solo para CLIENTE)
        return this.cargarSedesVinculadas();
      }),
      catchError((err) => {
        this.isLoading.set(false);
        this.error.set(mensajeDeError(err, 'Error al cargar barberías'));
        return of([]);
      }),
    );
  }

  /** GET /mi-estado/barberias - sedes del vínculo propio (H72) */
  private cargarSedesVinculadas(): Observable<BarberiaResumen[]> {
    return this.http.get<any>(this.apiUrlMisSedes).pipe(
      map((res) => this.normalizar(res)),
      catchError(() => of([])),
    );
  }

  private normalizar(res: any): BarberiaResumen[] {
    return Array.isArray(res) ? res : (res?.data ?? []);
  }

  /** Fija la sede activa que eligió el usuario (el botón «Seleccionar»). */
  seleccionarBarberia(barberiaId: string): Observable<any> {
    return this.cambiarSedeActiva(barberiaId);
  }

  /** Cambia el contexto de sede solo después de que el backend autorice la selección. */
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
      : this.cargarBarberias();

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

  /** PATCH /shops/:shopId/select - la única puerta para cambiar la sede activa. */
  private pedirSeleccion(barberiaId: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${barberiaId}/select`, {});
  }

  /** Vincula al usuario con una barbería usando un código de acceso de 8 caracteres. */
  vincularBarberia(codigoAcceso: string): Observable<VinculoDeCliente> {
    return this.unirsePorInvitacion({ codigoAcceso });
  }

  /** GET /mi-estado/unirse - la invitación de una sede (regla 1.10). */
  obtenerInvitacion(barberiaId: string): Observable<InvitacionSede> {
    this.error.set(null);
    return this.http.get<InvitacionSede>(`${this.apiUrl}/${barberiaId}/invitation`).pipe(
      catchError((err) => {
        this.error.set(
          mensajeDeError(err, 'No se pudo obtener la invitación de la sede'),
        );
        throw err;
      }),
    );
  }

  /** POST /mi-estado/unirse - el cliente ENTRA en una sede con la puerta que traiga. */
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
        this.error.set(mensajeDeError(err, 'No se pudo completar la unión'));
        throw err;
      }),
    );
  }

  /** Crea una nueva barbería y el usuario actual queda como Dueño/Responsable. */
  crearBarberia(dto: {
    nombre: string;
    ubicacion: string;
    telefono: string;
    descripcion?: string;
  }): Observable<any> {
    this.isLoading.set(true);
    return this.http.post(this.apiUrl, dto).pipe(
      tap((nuevaBarberia) => {
        this.cargarBarberias().subscribe(() => {
          this.seleccionarBarberia(
            (nuevaBarberia as any).id || (nuevaBarberia as any).data?.id,
          ).subscribe({
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

  /** E3-13 · edición directa de la sede (PATCH /shops/:shopId). */
  actualizarBarberia(barberiaId: string, dto: ActualizarBarberiaRequest): Observable<BarberiaResumen> {
    return this.http.patch<BarberiaResumen>(`${this.apiUrl}/${barberiaId}`, dto).pipe(
      tap((actualizada) => {
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

  /** H74 · la sede activa tiene que estar EN la lista. */
  private sincronizarSedeActiva(barberias: BarberiaResumen[], autoSeleccionar = true): void {
    const referencia = this.barberiaActiva()?.id ?? localStorage.getItem(this.storageKey);
    const conservada = referencia
      ? (barberias.find((b) => b.id === referencia) ?? null)
      : null;

    // La sede fijada solo sigue siendo la activa si sigue EN la lista.
    if (referencia && !conservada) {
      this.setBarberiaActiva(null);
    }

    // Misma sede que la actual: solo se refresca el objeto cacheado.
    if (conservada && conservada.id === this.barberiaActiva()?.id) {
      this.setBarberiaActiva(conservada);
      return;
    }

    // Si autoSeleccionar es false (admin global o caso especial), no autoasignamos.
    // El admin global elegirá su sede en el hub manualmente.
    if (!autoSeleccionar) {
      return;
    }

    // Rama normal: la candidata es la conservada o la primera con esBarberiaActiva
    const candidata =
      conservada ??
      barberias.find((b) => b.esBarberiaActiva) ??
      barberias[0] ??
      null;

    if (!candidata) {
      return;
    }

    // El backend decide qué sede pasa a ser activa. Hasta el 200 no hay sede activa.
    this.pedirSeleccion(candidata.id)
      .pipe(
        tap(() => this.setBarberiaActiva(candidata)),
        catchError((err) => {
          this.error.set(mensajeDeError(err, 'No se pudo seleccionar la sede activa'));
          return of(null);
        }),
      )
      .subscribe();
  }

  /** H74 - purga una sede de la sesión sin esperar a que vuelva la lista. */
  purgarBarberia(barberiaId: string): void {
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

  /** H74 - limpia el estado local de la sesión */
  purgarEstadoLocal(): void {
    // Limpiar cualquier purgador registrado
    this.error.set(null);
  }

  /** H74 - registra una función de purgado a ejecutar después */
  registrarPurgadorLocal(purgador: () => void): void {
    purgador();
  }

  private guardarSedeActiva(barberia: BarberiaResumen | null) {
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
    this.purgarEstadoLocal();
    this.guardarSedeActiva(null);
    this.barberiasVinculadas.set([]);
  }
}