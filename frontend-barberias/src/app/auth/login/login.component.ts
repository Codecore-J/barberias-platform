import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
              <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Correo Electrónico</label>
              <div class="relative group">
                <i class="pi pi-envelope absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input type="email" formControlName="correo" placeholder="tu@correo.com"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-xs font-bold text-zinc-400 uppercase tracking-widest pl-1">Contraseña</label>
              <div class="relative group">
                <i class="pi pi-lock absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors"></i>
                <input [type]="showPassword() ? 'text' : 'password'" formControlName="password" placeholder="••••••••"
                       class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3.5 pl-12 pr-12 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                <button type="button" (click)="togglePassword()" class="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-amber-400 focus:outline-none">
                  <i class="pi" [ngClass]="showPassword() ? 'pi-eye-slash' : 'pi-eye'"></i>
                </button>
              </div>
            </div>

            @if (authService.authState().error) {
              <div class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-shake flex items-center gap-2">
                <i class="pi pi-exclamation-circle"></i> {{ authService.authState().error }}
              </div>
            }

            <button type="submit" [disabled]="loginForm.invalid || authService.authState().isLoading"
                    class="w-full py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
              @if (authService.authState().isLoading) {
                <i class="pi pi-spin pi-spinner text-lg"></i> Ingresando...
              } @else {
                Iniciar Sesión <i class="pi pi-arrow-right"></i>
              }
            </button>
            
          </form>

          <div class="mt-8 text-center transform translate-z-8">
            <p class="text-zinc-500 text-sm">
              ¿No tienes una cuenta? 
              <a routerLink="/auth/register" class="text-amber-400 font-bold hover:text-amber-300 hover:underline underline-offset-4 ml-1 transition-colors">
                Regístrate aquí
              </a>
            </p>
          </div>

        </div>
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

  loginForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  onSubmit() {
    if (this.loginForm.valid) {
      this.authService.login(this.loginForm.value as any).subscribe();
    }
  }
}
