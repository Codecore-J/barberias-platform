import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, interval, switchMap } from 'rxjs';
import { API_URL } from '../constants/api.constants.js';
import { AuthService } from '../../auth/auth.service';

export interface Notificacion {
  id: string;
  titulo: string;
  mensaje: string;
  leida: boolean;
  fechaCreacion: string;
  tipo?: string; // Ej: 'RESERVA_CREADA', 'COBRO_REGISTRADO'
}

@Injectable({
  providedIn: 'root'
})
export class NotificacionesService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly apiUrl = `${API_URL}/notificaciones`;

  readonly notificaciones = signal<Notificacion[]>([]);
  readonly unreadCount = signal<number>(0);

  constructor() {
    // Iniciar polling solo si hay usuario logueado
    if (this.authService.authState().isAuthenticated) {
      this.cargarNotificaciones().subscribe();
      
      // Polling cada 30 segundos para simular tiempo real
      interval(30000).pipe(
        switchMap(() => {
          if (this.authService.authState().isAuthenticated) {
            return this.cargarNotificaciones();
          }
          return of([]);
        })
      ).subscribe();
    }
  }

  cargarNotificaciones(): Observable<Notificacion[]> {
    return this.http.get<Notificacion[]>(this.apiUrl).pipe(
      tap(data => {
        const dataArr = Array.isArray(data) ? data : (data as any).data || [];
        this.notificaciones.set(dataArr);
        this.unreadCount.set(dataArr.filter((n: Notificacion) => !n.leida).length);
      }),
      catchError(() => of([]))
    );
  }

  marcarComoLeida(id: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/leida`, {}).pipe(
      tap(() => {
        // Actualizar estado localmente
        const actualizadas = this.notificaciones().map((n: Notificacion) => 
          n.id === id ? { ...n, leida: true } : n
        );
        this.notificaciones.set(actualizadas);
        this.unreadCount.set(actualizadas.filter((n: Notificacion) => !n.leida).length);
      })
    );
  }
  
  marcarTodasComoLeidas(): Observable<any> {
    return this.http.post(`${this.apiUrl}/marcar-todas-leidas`, {}).pipe(
      tap(() => {
        // Actualizar estado localmente
        const actualizadas = this.notificaciones().map((n: Notificacion) => ({ ...n, leida: true }));
        this.notificaciones.set(actualizadas);
        this.unreadCount.set(0);
      })
    );
  }
}
