import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { CardModule } from 'primeng/card';
import { RegisterDto } from '../interfaces/auth.interface';

@Component({
  selector: 'app-register',
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
      <p-card header="Crear Cuenta" class="w-full max-w-md shadow-lg">
        <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="flex flex-col gap-4 mt-4">
          
          <div class="flex flex-col gap-2">
            <label for="nombreCompleto" class="font-semibold text-gray-700">Nombre Completo</label>
            <input 
              id="nombreCompleto" 
              type="text" 
              pInputText 
              formControlName="nombreCompleto" 
              placeholder="Ej. Juan Pérez"
              class="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': registerForm.get('nombreCompleto')?.invalid && registerForm.get('nombreCompleto')?.touched}"
            />
            <small *ngIf="registerForm.get('nombreCompleto')?.invalid && registerForm.get('nombreCompleto')?.touched" class="text-red-500">
              Nombre completo es requerido (min 3 caracteres).
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="correo" class="font-semibold text-gray-700">Correo Electrónico</label>
            <input 
              id="correo" 
              type="email" 
              pInputText 
              formControlName="correo" 
              placeholder="tu@correo.com"
              class="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': registerForm.get('correo')?.invalid && registerForm.get('correo')?.touched}"
            />
            <small *ngIf="registerForm.get('correo')?.invalid && registerForm.get('correo')?.touched" class="text-red-500">
              El correo es requerido y debe ser válido.
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="telefono" class="font-semibold text-gray-700">Teléfono *</label>
            <input 
              id="telefono" 
              type="tel" 
              pInputText 
              formControlName="telefono" 
              placeholder="+123456789"
              class="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': registerForm.get('telefono')?.invalid && registerForm.get('telefono')?.touched}"
            />
            <small *ngIf="registerForm.get('telefono')?.invalid && registerForm.get('telefono')?.touched" class="text-red-500">
              El teléfono es obligatorio.
            </small>
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="font-semibold text-gray-700">Contraseña</label>
            <p-password 
              id="password" 
              formControlName="password" 
              [toggleMask]="true"
              promptLabel="Ingresa una contraseña"
              weakLabel="Débil"
              mediumLabel="Media"
              strongLabel="Fuerte"
              placeholder="********"
              styleClass="w-full"
              inputStyleClass="w-full p-3"
              [ngClass]="{'ng-invalid ng-dirty': registerForm.get('password')?.invalid && registerForm.get('password')?.touched}">
            </p-password>
            <small *ngIf="registerForm.get('password')?.invalid && registerForm.get('password')?.touched" class="text-red-500">
              Contraseña es requerida (min 8 caracteres, 1 mayúscula, 1 minúscula y 1 número o símbolo).
            </small>
          </div>

          <div *ngIf="authService.authState().error" class="p-3 bg-red-100 text-red-700 rounded-md border border-red-200">
            {{ authService.authState().error }}
          </div>

          <p-button 
            type="submit" 
            label="Registrarse" 
            [loading]="authService.authState().isLoading" 
            [disabled]="registerForm.invalid"
            styleClass="w-full mt-2 p-3">
          </p-button>

          <div class="text-center mt-4 text-sm text-gray-600">
            ¿Ya tienes cuenta? 
            <a routerLink="/auth/login" class="text-blue-600 font-semibold hover:underline">Inicia Sesión</a>
          </div>
        </form>
      </p-card>
    </div>
  `
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  authService = inject(AuthService);

  registerForm = this.fb.group({
    nombreCompleto: ['', [Validators.required, Validators.minLength(3)]],
    correo: ['', [Validators.required, Validators.email]],
    telefono: ['', [Validators.required]],
    password: ['', [
      Validators.required, 
      Validators.minLength(8), 
      Validators.pattern(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/)
    ]],
  });

  onSubmit() {
    if (this.registerForm.valid) {
      const data: RegisterDto = {
        ...this.registerForm.value
      } as RegisterDto;

      this.authService.register(data).subscribe();
    }
  }
}
