import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-crear-barberia',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="min-h-[85vh] flex items-center justify-center p-4 bg-ambient-mesh transform-style-3d">
      <div class="glass-panel w-full max-w-2xl rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden border border-amber-500/30">
        
        <!-- Glow 3D -->
        <div class="absolute -top-20 -left-20 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div class="relative z-10 space-y-8 transform translate-z-12">
          <!-- Header -->
          <div class="text-center space-y-2">
            <h1 class="text-4xl font-display font-bold text-white">Registrar <span class="gold-gradient-text">Barbería</span></h1>
            <p class="text-zinc-400">Crea tu espacio de trabajo para comenzar a gestionar servicios y agendamientos.</p>
          </div>

          <!-- Formulario -->
          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-6">
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <!-- Nombre -->
              <div class="space-y-2 col-span-1 sm:col-span-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Nombre del Local</label>
                <div class="relative">
                  <i class="pi pi-building absolute left-4 top-1/2 -translate-y-1/2 text-amber-500"></i>
                  <input type="text" formControlName="nombre" placeholder="Ej: The Gentlemen's Barbershop"
                         class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>
              </div>

              <!-- Teléfono -->
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Teléfono</label>
                <div class="relative">
                  <i class="pi pi-phone absolute left-4 top-1/2 -translate-y-1/2 text-amber-500"></i>
                  <input type="text" formControlName="telefono" placeholder="+1 234 567 8900"
                         class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>
              </div>

              <!-- Ubicación -->
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Ubicación / Ciudad</label>
                <div class="relative">
                  <i class="pi pi-map-marker absolute left-4 top-1/2 -translate-y-1/2 text-amber-500"></i>
                  <input type="text" formControlName="ubicacion" placeholder="Madrid, España"
                         class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>
              </div>

              <!-- Descripción -->
              <div class="space-y-2 col-span-1 sm:col-span-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Descripción (Opcional)</label>
                <div class="relative">
                  <i class="pi pi-info-circle absolute left-4 top-4 text-amber-500"></i>
                  <textarea formControlName="descripcion" rows="3" placeholder="Una breve descripción de tu barbería..."
                         class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner resize-none"></textarea>
                </div>
              </div>
            </div>

            @if (tenantService.error()) {
              <div class="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center">
                <i class="pi pi-exclamation-triangle mr-3 text-lg"></i> {{ tenantService.error() }}
              </div>
            }

            <div class="pt-6 flex flex-col-reverse sm:flex-row gap-4 transform translate-z-24">
              <a routerLink="/barberias" class="flex-1 px-6 py-4 rounded-xl font-bold text-sm text-zinc-300 glass-card text-center hover:text-white hover:bg-zinc-800 transition-colors">
                Cancelar
              </a>
              <button type="submit" [disabled]="form.invalid || isSubmitting()"
                      class="flex-[2] px-6 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
                @if (isSubmitting()) {
                  <i class="pi pi-spin pi-spinner text-lg"></i> Creando Espacio...
                } @else {
                  <i class="pi pi-check text-lg"></i> Registrar Barbería
                }
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  `
})
export class CrearBarberiaComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);

  isSubmitting = signal(false);

  form: FormGroup = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(3)]],
    telefono: ['', [Validators.required]],
    ubicacion: ['', [Validators.required]],
    descripcion: ['']
  });

  onSubmit() {
    if (this.form.invalid) return;

    this.isSubmitting.set(true);
    this.tenantService.crearBarberia(this.form.value).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.router.navigate(['/barberias']); // Redirigir al Hub donde ya estará activa
      },
      error: () => {
        this.isSubmitting.set(false);
      }
    });
  }
}
