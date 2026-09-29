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

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:3000/api/v1/notificaciones';

  readonly notificaciones = signal<NotificacionItem[]>([]);
  readonly noLeidasCount = signal<number>(0);
  readonly isLoading = signal<boolean>(false);

  cargarNotificaciones(): Observable<NotificacionItem[]> {
    this.isLoading.set(true);
    return this.http.get<NotificacionItem[]>(`${this.apiUrl}/mis-notificaciones`).pipe(
      tap((items) => {
        const list = Array.isArray(items) ? items : [];
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
}
