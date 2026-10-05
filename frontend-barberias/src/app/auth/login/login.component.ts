import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-ambient-mesh p-4 perspective-1200 overflow-hidden">
      
      <!-- Fondo Atmosférico extra -->
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-amber-500/10 rounded-full blur-[120px] mix-blend-screen"></div>
        <div class="absolute bottom-[0%] -right-[10%] w-[60%] h-[60%] bg-amber-700/10 rounded-full blur-[150px] mix-blend-screen"></div>
      </div>

      <div class="relative z-10 w-full max-w-md transform-style-3d animate-fade-in-up">
        
        <!-- Tarjeta de Login -->
        <div class="glass-panel p-8 sm:p-10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-amber-500/30 transform translate-z-12 hover:rotate-y-2 hover:rotate-x-2 transition-transform duration-500">
          
          <div class="text-center space-y-2 mb-10 transform translate-z-8">
            <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-[0_0_20px_rgba(212,175,55,0.3)] mb-4">
              <div class="w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center">
                <i class="pi pi-sparkles text-amber-400 text-3xl"></i>
              </div>
            </div>
            <h1 class="text-3xl font-display font-extrabold text-white tracking-wide">IMPERIAL <span class="gold-gradient-text">BARBERS</span></h1>
            <p class="text-zinc-400 text-sm">Bienvenido de vuelta. Ingresa a tu cuenta.</p>
          </div>

          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="space-y-6 transform translate-z-12">
            
            <div class="space-y-2">
              <label for="correo" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Correo Electrónico</label>
              <div class="relative group">
                <i class="pi pi-envelope absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input id="correo" name="correo" type="email" autocomplete="email" formControlName="correo" placeholder="tu@correo.com"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
              </div>
            </div>

            <div class="space-y-2">
              <label for="password" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Contraseña</label>
              <div class="relative group">
                <i class="pi pi-lock absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input id="password" name="password" [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password" formControlName="password" placeholder="••••••••"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-12 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                <button type="button" (click)="togglePassword()" aria-label="Mostrar u ocultar contraseña" class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-amber-400 focus:outline-none">
                  <i class="pi" [ngClass]="showPassword() ? 'pi-eye-slash' : 'pi-eye'"></i>
                </button>
              </div>
            </div>

            <div class="flex items-center justify-end -mt-1">
              <button type="button" (click)="openRecoveryModal()" class="text-xs text-amber-400/90 hover:text-amber-300 hover:underline underline-offset-2 transition-colors cursor-pointer">
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            @if (authService.authState().error) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-shake flex items-center gap-2">
                <i class="pi pi-exclamation-circle"></i> {{ authService.authState().error }}
              </div>
            }

            <button type="submit" [disabled]="loginForm.invalid || authService.authState().isLoading"
                    class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2 cursor-pointer">
              @if (authService.authState().isLoading) {
                <i class="pi pi-spin pi-spinner text-lg"></i> Ingresando...
              } @else {
                Iniciar Sesión <i class="pi pi-arrow-right"></i>
              }
            </button>
            
          </form>

          <!-- Acceso Rápido Demo -->
          <div class="mt-6 pt-5 border-t border-zinc-800/80 text-center transform translate-z-8">
            <p class="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2.5">Acceso Rápido Demo</p>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <button type="button" (click)="fillDemo('cliente@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                👤 Cliente
              </button>
              <button type="button" (click)="fillDemo('barbero@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                ✂️ Barbero
              </button>
              <button type="button" (click)="fillDemo('admin@demo.com')" class="px-2.5 py-1 text-xs rounded-lg bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-400 border border-zinc-700/60 hover:border-amber-500/40 transition-colors cursor-pointer">
                ⚡ Admin
              </button>
            </div>
          </div>

          <div class="mt-6 text-center transform translate-z-8">
            <p class="text-zinc-500 text-sm">
              ¿No tienes una cuenta? 
              <a routerLink="/auth/register" class="text-amber-400 font-bold hover:text-amber-300 hover:underline underline-offset-4 ml-1 transition-colors">
                Regístrate aquí
              </a>
            </p>
          </div>

        </div>

        <!-- Modal de Recuperación de Contraseña (SEC-01) -->
        @if (showRecoveryModal()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in-up">
            <div class="relative w-full max-w-md bg-zinc-950/95 border border-amber-500/40 rounded-3xl p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
              
              <button type="button" (click)="closeRecoveryModal()" class="absolute top-5 right-5 text-zinc-400 hover:text-white transition-colors cursor-pointer">
                <i class="pi pi-times text-lg"></i>
              </button>

              <div class="text-center mb-6">
                <div class="w-12 h-12 mx-auto rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3">
                  <i class="pi pi-key text-amber-400 text-xl"></i>
                </div>
                <h2 class="text-xl font-display font-bold text-white">Recuperar Contraseña</h2>
                <p class="text-xs text-zinc-400 mt-1">
                  @if (recoveryStep() === 1) {
                    Ingresa tu correo para recibir un enlace/token de restablecimiento.
                  } @else {
                    Ingresa el token recibido y tu nueva contraseña.
                  }
                </p>
              </div>

              @if (recoverySuccessMsg()) {
                <div class="mb-4 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-2">
                  <i class="pi pi-check-circle text-base"></i> {{ recoverySuccessMsg() }}
                </div>
              }

              @if (recoveryErrorMsg()) {
                <div class="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-2">
                  <i class="pi pi-exclamation-triangle text-base"></i> {{ recoveryErrorMsg() }}
                </div>
              }

              @if (recoveryStep() === 1) {
                <form [formGroup]="forgotForm" (ngSubmit)="onForgotSubmit()" class="space-y-4">
                  <div class="space-y-1.5">
                    <label for="recoveryEmail" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Correo Electrónico</label>
                    <input id="recoveryEmail" type="email" formControlName="correo" placeholder="tu@correo.com"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm">
                  </div>

                  <button type="submit" [disabled]="forgotForm.invalid || isRecoveryLoading()"
                          class="w-full py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2">
                    @if (isRecoveryLoading()) {
                      <i class="pi pi-spin pi-spinner"></i> Enviando...
                    } @else {
                      Enviar Instrucciones <i class="pi pi-arrow-right"></i>
                    }
                  </button>

                  <div class="text-center pt-2">
                    <button type="button" (click)="goToStep(2)" class="text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                      ¿Ya tienes un token de recuperación? Ingresar aquí
                    </button>
                  </div>
                </form>
              } @else {
                <form [formGroup]="resetForm" (ngSubmit)="onResetSubmit()" class="space-y-4">
                  <div class="space-y-1.5">
                    <label for="recoveryToken" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Token de Recuperación</label>
                    <input id="recoveryToken" type="text" formControlName="token" placeholder="Pega el token aquí"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm font-mono">
                  </div>

                  <div class="space-y-1.5">
                    <label for="recoveryNewPassword" class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Nueva Contraseña (mín. 8 caracteres)</label>
                    <input id="recoveryNewPassword" type="password" formControlName="newPassword" placeholder="••••••••"
                           class="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 px-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors shadow-inner text-sm">
                  </div>

                  <button type="submit" [disabled]="resetForm.invalid || isRecoveryLoading()"
                          class="w-full py-3.5 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2">
                    @if (isRecoveryLoading()) {
                      <i class="pi pi-spin pi-spinner"></i> Actualizando...
                    } @else {
                      Restablecer Contraseña <i class="pi pi-check"></i>
                    }
                  </button>

                  <div class="text-center pt-2">
                    <button type="button" (click)="goToStep(1)" class="text-xs text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer">
                      ← Volver a solicitar token
                    </button>
                  </div>
                </form>
              }

            </div>
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
    @keyframes fadeInUp {
      0% { opacity: 0; transform: translateY(30px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes shake {
      10%, 90% { transform: translate3d(-1px, 0, 0); }
      20%, 80% { transform: translate3d(2px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-3px, 0, 0); }
      40%, 60% { transform: translate3d(3px, 0, 0); }
    }
  `]
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  authService = inject(AuthService);
  
  showPassword = signal(false);
  showRecoveryModal = signal(false);
  recoveryStep = signal<1 | 2>(1);
  isRecoveryLoading = signal(false);
  recoverySuccessMsg = signal<string | null>(null);
  recoveryErrorMsg = signal<string | null>(null);

  loginForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  forgotForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
  });

  resetForm = this.fb.group({
    token: ['', [Validators.required, Validators.minLength(10)]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  fillDemo(correo: string, pass: string = 'Password123!') {
    this.loginForm.patchValue({ correo, password: pass });
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  openRecoveryModal() {
    this.recoveryStep.set(1);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
    this.forgotForm.reset({ correo: this.loginForm.value.correo || '' });
    this.showRecoveryModal.set(true);
  }

  closeRecoveryModal() {
    this.showRecoveryModal.set(false);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
  }

  goToStep(step: 1 | 2) {
    this.recoveryStep.set(step);
    this.recoverySuccessMsg.set(null);
    this.recoveryErrorMsg.set(null);
  }

  onForgotSubmit() {
    if (this.forgotForm.invalid) return;
    this.isRecoveryLoading.set(true);
    this.recoveryErrorMsg.set(null);
    this.recoverySuccessMsg.set(null);

    const email = this.forgotForm.value.correo!;
    this.authService.forgotPassword(email).subscribe({
      next: (res) => {
        this.isRecoveryLoading.set(false);
        this.recoverySuccessMsg.set(res.message);
        // Si en desarrollo/demo devuelve debugToken, lo pre-cargamos para facilitar la prueba
        if (res.debugToken) {
          this.resetForm.patchValue({ token: res.debugToken });
        }
        setTimeout(() => {
          this.recoveryStep.set(2);
        }, 1500);
      },
      error: (err) => {
        this.isRecoveryLoading.set(false);
        this.recoveryErrorMsg.set(err.error?.message || 'Error al procesar la solicitud.');
      }
    });
  }

  onResetSubmit() {
    if (this.resetForm.invalid) return;
    this.isRecoveryLoading.set(true);
    this.recoveryErrorMsg.set(null);
    this.recoverySuccessMsg.set(null);

    const { token, newPassword } = this.resetForm.value;
    this.authService.resetPassword(token!, newPassword!).subscribe({
      next: (res) => {
        this.isRecoveryLoading.set(false);
        this.recoverySuccessMsg.set(res.message);
        setTimeout(() => {
          this.closeRecoveryModal();
          this.loginForm.patchValue({ password: newPassword });
        }, 2000);
      },
      error: (err) => {
        this.isRecoveryLoading.set(false);
        this.recoveryErrorMsg.set(err.error?.message || 'El token es inválido o ha expirado.');
      }
    });
  }

  onSubmit() {
    if (this.loginForm.valid) {
      this.authService.login(this.loginForm.value as any).subscribe({
        next: () => {},
        error: () => {}
      });
    }
  }
}

