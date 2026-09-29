import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';

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

  cargarNotificaciones(): Observable<NotificacionItem[]> {
    this.isLoading.set(true);
    return this.http.get<NotificacionItem[]>(`${this.apiUrl}/mis-notificaciones`).pipe(
      tap((items) => {
        const list = Array.isArray(items) ? items : (items as any).data || [];
        this.notificaciones.set(list);
        this.noLeidasCount.set(list.filter((n) => !n.leido).length);
        this.isLoading.set(false);
      }),
      catchError(() => {
        this.isLoading.set(false);
        return of([]);
      }),
    );
  }

  marcarComoLeida(id: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/leida`, {}).pipe(
      tap(() => {
        const actualizadas = this.notificaciones().map(n => 
          n.id === id ? { ...n, leido: true } : n
        );
        this.notificaciones.set(actualizadas);
        this.noLeidasCount.set(actualizadas.filter(n => !n.leido).length);
      })
    );
  }

  marcarTodasComoLeidas(): Observable<any> {
    return this.http.post(`${this.apiUrl}/marcar-todas-leidas`, {}).pipe(
      tap(() => {
        const actualizadas = this.notificaciones().map(n => ({ ...n, leido: true }));
        this.notificaciones.set(actualizadas);
        this.noLeidasCount.set(0);
      })
    );
  }
}
