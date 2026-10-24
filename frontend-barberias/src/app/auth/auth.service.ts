import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, shareReplay } from 'rxjs';
import { Router } from '@angular/router';
import {
  AuthResponseDto,
  LoginDto,
  RegisterDto,
  UsuarioResponseDto
} from './interfaces/auth.interface';

export interface AuthState {
  user: UsuarioResponseDto | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

import { API_URL } from '../core/constants/api.constants.js';
import { TenantService } from '../core/services/tenant.service';
import { returnUrlSeguro } from '../core/utils/return-url.util';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tenantService = inject(TenantService);
  private readonly apiUrl = `${API_URL}/auth`;
  private readonly tokenKey = 'access_token';

  /**
   * H-02 · hidratación de la sesión COMARTIDA: una sola petición `GET /me` por
   * token, compartida entre el constructor (`checkSession`) y los guards que
   * necesitan el usuario ya cargado antes de decidir —tras un F5, el
   * `roleGuard` espera este observable en vez de redirigir a login con el
   * token aún válido. Se invalida al cambiar el token (login/logout).
   */
  private sesionCargada$: Observable<UsuarioResponseDto | null> | null = null;

  // Reactive state using Angular Signals
  readonly authState = signal<AuthState>({
    user: null,
    isAuthenticated: !!localStorage.getItem('access_token'),
    isLoading: !!localStorage.getItem('access_token'),
    error: null
  });

  constructor() {
    this.checkSession();
  }

  private setToken(token: string) {
    localStorage.setItem(this.tokenKey, token);
    this.sesionCargada$ = null;
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  private removeToken() {
    localStorage.removeItem(this.tokenKey);
    this.sesionCargada$ = null;
  }

  private updateState(partialState: Partial<AuthState>) {
    this.authState.update(state => ({ ...state, ...partialState }));
  }

  /**
   * H75 · `returnUrl` es la ruta que la persona pedía cuando el `authGuard` la
   * mandó a la pantalla de sesión. Llega por query y NO se usa tal cual:
   * `returnUrlSeguro` la filtra antes de navegar (solo rutas internas).
   */
  register(data: RegisterDto, returnUrl?: string | null): Observable<AuthResponseDto> {
    this.updateState({ isLoading: true, error: null });
    return this.http.post<AuthResponseDto>(`${this.apiUrl}/register`, data).pipe(
      tap(response => {
        this.setToken(response.accessToken);
        this.updateState({
          user: response.usuario,
          isAuthenticated: true,
          isLoading: false,
          error: null
        });
        // Una cuenta recién creada también puede venir de un enlace (el QR de
        // una sede): si hay destino válido se respeta, si no, al dashboard.
        this.router.navigateByUrl(returnUrlSeguro(returnUrl) ?? '/');
      }),
      catchError(error => {
        const errorMsg = error.error?.message || 'Error en el registro';
        this.updateState({ isLoading: false, error: errorMsg });
        throw error;
      })
    );
  }

  /**
   * H75 · `returnUrl` es la ruta que la persona pedía cuando el `authGuard` la
   * mandó al login; viaja por query y `returnUrlSeguro` la filtra antes de
   * navegar. Si no hay destino válido se aplica el destino por rol de siempre.
   */
  login(data: LoginDto, returnUrl?: string | null): Observable<AuthResponseDto> {
    this.updateState({ isLoading: true, error: null });
    return this.http.post<AuthResponseDto>(`${this.apiUrl}/login`, data).pipe(
      tap(response => {
        this.setToken(response.accessToken);
        this.updateState({
          user: response.usuario,
          isAuthenticated: true,
          isLoading: false,
          error: null
        });

        // H75 · si la persona venía de una ruta concreta, esa ruta manda sobre
        // el destino por rol: ya había dicho a dónde iba al abrir el enlace (el
        // QR de una sede, por ejemplo) y devolverla al dashboard sería perderla
        // otra vez. Que la pantalla de destino pueda o no hacer algo con ese
        // usuario lo decide ella, no este método.
        const destino = returnUrlSeguro(returnUrl);
        if (destino) {
          this.router.navigateByUrl(destino);
          return;
        }

        const roles = response.usuario.roles || [];
        const isAdmin =
          roles.includes('ADMINISTRADOR') ||
          roles.includes('ADMIN_BARBERIA') ||
          roles.includes('ADMIN');
        const isBarbero = roles.includes('BARBERO');

        if (isAdmin) {
          this.tenantService.cargarBarberias().subscribe({
            next: (barberias) => {
              if (barberias.length > 0) {
                this.router.navigate(['/admin/agenda']); // Admin va directo a la agenda
              } else {
                this.router.navigate(['/barberias']); // Sin barberías, elegir/crear una
              }
            },
            error: () => this.router.navigate(['/barberias'])
          });
        } else if (isBarbero) {
          this.tenantService.cargarBarberias().subscribe({
            next: (barberias) => {
              if (barberias.length > 0) {
                this.router.navigate(['/admin/agenda']); // Barbero también va a la agenda
              } else {
                this.router.navigate(['/barberias']);
              }
            },
            error: () => this.router.navigate(['/barberias'])
          });
        } else {
          this.router.navigate(['/']); // Home cliente
        }
      }),
      catchError(error => {
        const errorMsg = error.error?.message || 'Credenciales inválidas';
        this.updateState({ isLoading: false, error: errorMsg });
        throw error;
      })
    );
  }

  logout() {
    this.removeToken();
    this.updateState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null
    });
    this.router.navigate(['/auth/login']);
  }

  checkSession(): void {
    this.cargarSesion().subscribe();
  }

  /**
   * H-02 · resuelve la sesión hidratando el usuario (`GET /me`) UNA sola vez
   * por token. Sin token no hay nada que hidratar; con token, la primera
   * suscripción dispara la petición y el resto espera el MISMO resultado
   * (shareReplay), así que un guard puede llamarla en paralelo al constructor
   * sin duplicar la llamada. `catchError` cierra la sesión inválida y devuelve
   * `null`, que el caller interpreta como «sin usuario».
   */
  cargarSesion(): Observable<UsuarioResponseDto | null> {
    if (!this.sesionCargada$) {
      if (!this.getToken()) {
        this.updateState({ isLoading: false });
        this.sesionCargada$ = of(null);
      } else {
        this.sesionCargada$ = this.http.get<UsuarioResponseDto>(`${this.apiUrl}/me`).pipe(
          tap(user => {
            this.updateState({
              user,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            });
          }),
          catchError(() => {
            this.logout();
            return of(null);
          }),
          shareReplay(1),
        );
      }
    }
    return this.sesionCargada$;
  }

  forgotPassword(correo: string): Observable<{ message: string; debugToken?: string }> {
    return this.http.post<{ message: string; debugToken?: string }>(`${this.apiUrl}/forgot-password`, { correo });
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/reset-password`, { token, newPassword });
  }
}
