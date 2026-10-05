import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
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

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tenantService = inject(TenantService);
  private readonly apiUrl = `${API_URL}/auth`;
  private readonly tokenKey = 'access_token';

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
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  private removeToken() {
    localStorage.removeItem(this.tokenKey);
  }

  private updateState(partialState: Partial<AuthState>) {
    this.authState.update(state => ({ ...state, ...partialState }));
  }

  register(data: RegisterDto): Observable<AuthResponseDto> {
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
        this.router.navigate(['/']); // Redirect to dashboard or home
      }),
      catchError(error => {
        const errorMsg = error.error?.message || 'Error en el registro';
        this.updateState({ isLoading: false, error: errorMsg });
        throw error;
      })
    );
  }

  login(data: LoginDto): Observable<AuthResponseDto> {
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
    const token = this.getToken();
    if (!token) {
      this.updateState({ isLoading: false });
      return;
    }

    this.http.get<UsuarioResponseDto>(`${this.apiUrl}/me`).pipe(
      tap(user => {
        this.updateState({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null
        });
      }),
      catchError(() => {
        this.logout();
        return of(null);
      })
    ).subscribe();
  }

  forgotPassword(correo: string): Observable<{ message: string; debugToken?: string }> {
    return this.http.post<{ message: string; debugToken?: string }>(`${this.apiUrl}/forgot-password`, { correo });
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/reset-password`, { token, newPassword });
  }
}
