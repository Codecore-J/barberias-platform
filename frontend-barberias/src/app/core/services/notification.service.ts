import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, tap, catchError, of, finalize, shareReplay } from 'rxjs';
import { SILENCIAR_TOAST } from '../interceptors/error.interceptor';

export interface NotificacionItem {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  leido: boolean;
  creadoAt: string;
}

import { API_URL } from '../constants/api.constants.js';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${API_URL}/notificaciones`;

  readonly notificaciones = signal<NotificacionItem[]>([]);
  readonly noLeidasCount = signal<number>(0);
  readonly isLoading = signal<boolean>(false);

  /**
   * Fase 2b · instante en que se resolvió la última carga (`0` = nunca).
   *
   * Marca la edad del listado que hay en pantalla. Las acciones que lo dejan
   * al día por su cuenta —marcar leída, marcar todas— la reescriben, porque
   * entonces el estado local es la verdad que dejó el backend.
   */
  private ultimaCarga = 0;

  /**
   * Fase 2b · cuánto vale el listado antes de volver a preguntarlo.
   *
   * No es una caché «a ciegas»: el endpoint SÍ cambia solo (reservas, cobros),
   * así que el listado caduca. Lo que se evita es la petición por cada apertura
   * del panel, y no se reintroduce ningún sondeo de fondo.
   */
  private readonly VIGENCIA_MS = 60_000;

  /** Fase 2b · la carga en vuelo, compartida por quien la pida a la vez. */
  private enVuelo$: Observable<NotificacionItem[]> | null = null;

  /**
   * Fase 2b · el listado si sigue vigente, o una carga nueva si caducó.
   *
   * Es la puerta que usa el layout: al montar y al abrir la campana. Abrir y
   * cerrar el panel no dispara peticiones; dejarlo cerrado media hora y abrirlo
   * sí, que es cuando el dato importa.
   */
  asegurarCargadas(): Observable<NotificacionItem[]> {
    const vigente =
      this.ultimaCarga > 0 && Date.now() - this.ultimaCarga < this.VIGENCIA_MS;

    if (vigente) return of([...this.notificaciones()]);

    return this.cargarNotificaciones();
  }

  /** Carga explícita: siempre pregunta, ignorando la vigencia. */
  cargarNotificaciones(): Observable<NotificacionItem[]> {
    if (this.enVuelo$) return this.enVuelo$;

    this.isLoading.set(true);
    // Sondeo de fondo del layout: si falla, la campana se queda sin datos pero
    // el usuario no necesita un toast rojo cada pocos segundos (ya lo hizo el
    // `catchError` de abajo devolviendo la lista vacía).
    this.enVuelo$ = this.http
      .get<NotificacionItem[]>(`${this.apiUrl}/mis-notificaciones`, {
        context: new HttpContext().set(SILENCIAR_TOAST, true),
      })
      .pipe(
        tap((items) => {
          const list = Array.isArray(items) ? items : (items as any).data || [];
          this.notificaciones.set(list);
          this.noLeidasCount.set(list.filter((n: NotificacionItem) => !n.leido).length);
          // Un fallo no llega aqui: el `catchError` de abajo se queda sin fijar
          // la vigencia, y el siguiente `asegurarCargadas` vuelve a intentarlo.
          this.ultimaCarga = Date.now();
          this.isLoading.set(false);
        }),
        catchError(() => {
          this.isLoading.set(false);
          return of([]);
        }),
        finalize(() => {
          this.enVuelo$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.enVuelo$;
  }

  marcarComoLeida(id: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/leida`, {}).pipe(
      tap(() => {
        const actualizadas = this.notificaciones().map((n: NotificacionItem) => 
          n.id === id ? { ...n, leido: true } : n
        );
        this.notificaciones.set(actualizadas);
        this.noLeidasCount.set(actualizadas.filter((n: NotificacionItem) => !n.leido).length);
        // El backend ya confirmo: el listado local es la version vigente.
        this.ultimaCarga = Date.now();
      })
    );
  }

  marcarTodasComoLeidas(): Observable<any> {
    return this.http.post(`${this.apiUrl}/marcar-todas-leidas`, {}).pipe(
      tap(() => {
        const actualizadas = this.notificaciones().map((n: NotificacionItem) => ({ ...n, leido: true }));
        this.notificaciones.set(actualizadas);
        this.noLeidasCount.set(0);
        // Marcar todo como leido deja el listado al dia sin pedirlo otra vez.
        this.ultimaCarga = Date.now();
      })
    );
  }
}
