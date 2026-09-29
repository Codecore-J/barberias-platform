import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    CardModule
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <p-card header="Iniciar Sesión" class="w-full max-w-md shadow-lg">
        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="flex flex-col gap-4 mt-4">
          
          <div class="flex flex-col gap-2">
            <label for="correo" class="font-semibold text-gray-700">Correo Electrónico</label>
            <input 
              id="correo" 
              type="email" 
              pInputText 
              formControlName="correo" 
              placeholder="tu@correo.com"
              class="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': loginForm.get('correo')?.invalid && loginForm.get('correo')?.touched}"
            />
            <small *ngIf="loginForm.get('correo')?.invalid && loginForm.get('correo')?.touched" class="text-red-500">
              El correo es requerido y debe ser válido.
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="font-semibold text-gray-700">Contraseña</label>
            <p-password 
              id="password" 
              formControlName="password" 
              [feedback]="false"
              [toggleMask]="true"
              placeholder="********"
              styleClass="w-full"
              inputStyleClass="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': loginForm.get('password')?.invalid && loginForm.get('password')?.touched}">
            </p-password>
            <small *ngIf="loginForm.get('password')?.invalid && loginForm.get('password')?.touched" class="text-red-500">
              Contraseña es requerida.
            </small>
          </div>

          <div *ngIf="authService.authState().error" class="p-3 bg-red-100 text-red-700 rounded-md border border-red-200">
            {{ authService.authState().error }}
          </div>

          <p-button 
            type="submit" 
            label="Ingresar" 
            [loading]="authService.authState().isLoading" 
            [disabled]="loginForm.invalid"
            styleClass="w-full mt-2 p-3">
          </p-button>

          <div class="text-center mt-4 text-sm text-gray-600">
            ¿No tienes cuenta? 
            <a routerLink="/auth/register" class="text-blue-600 font-semibold hover:underline">Regístrate aquí</a>
          </div>
        </form>
      </p-card>
    </div>
  `
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  authService = inject(AuthService);

  loginForm = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  onSubmit() {
    if (this.loginForm.valid) {
      this.authService.login(this.loginForm.value as any).subscribe();
    }
  }
}
