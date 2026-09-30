import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AntecedentesService, Antecedente } from '../../../core/services/antecedentes.service';
import { TenantService } from '../../../core/services/tenant.service';

@Component({
  selector: 'app-admin-antecedentes',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  template: `
    <div class="min-h-screen py-10 px-4 max-w-5xl mx-auto space-y-8 bg-ambient-mesh">
      
      <div class="mb-10 relative z-20">
        <h2 class="text-3xl font-display font-bold text-white">Aprobación de <span class="text-amber-400">Antecedentes</span></h2>
        <p class="text-sm text-zinc-400">Revisa y aprueba las notas médicas/delicadas enviadas por tus barberos.</p>
      </div>

      @if (cargando()) {
        <div class="flex justify-center items-center py-20 relative z-10">
          <i class="pi pi-spin pi-spinner text-4xl text-amber-500"></i>
        </div>
      }

      @if (!cargando() && pendientes().length === 0) {
        <div class="glass-panel p-10 text-center rounded-3xl border border-white/5 relative z-10">
          <div class="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center text-4xl text-emerald-500 mb-4">
            <i class="pi pi-check-circle"></i>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Todo al día</h3>
          <p class="text-zinc-400">No hay antecedentes pendientes de aprobación.</p>
        </div>
      }

      @if (!cargando() && pendientes().length > 0) {
        <div class="space-y-4 relative z-10">
          @for (ant of pendientes(); track ant.id) {
            <div class="glass-panel p-6 rounded-2xl border border-amber-500/30 shadow-lg flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
              
              <div class="space-y-3 flex-1">
                <div class="flex items-center gap-3">
                  <span class="px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg border border-amber-500/30 text-amber-400 bg-amber-500/10">
                    PENDIENTE
                  </span>
                  <span class="text-xs text-zinc-400"><i class="pi pi-clock mr-1"></i>{{ ant.creadoAt | date:'short' }}</span>
                </div>
                
                <div>
                  <h4 class="text-lg font-bold text-white mb-1">
                    Cliente: <span class="text-amber-400">{{ ant.cliente?.nombreCompleto || 'Desconocido' }}</span>
                  </h4>
                  <p class="text-sm text-zinc-300 bg-black/30 p-3 rounded-xl border border-white/5 leading-relaxed">
                    "{{ ant.descripcion }}"
                  </p>
                </div>
                
                <div class="text-xs text-zinc-500 flex items-center gap-2">
                  <i class="pi pi-user"></i> Reportado por: <strong class="text-zinc-300">{{ ant.barbero?.nombreCompleto || 'Barbero' }}</strong>
                </div>
              </div>

              <!-- Acciones -->
              <div class="flex flex-col gap-3 w-full md:w-auto">
                <button (click)="aprobar(ant)" [disabled]="procesando() === ant.id"
                        class="px-6 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all">
                  <i class="pi" [ngClass]="procesando() === ant.id ? 'pi-spin pi-spinner' : 'pi-check'"></i> Aprobar
                </button>
                <button (click)="rechazar(ant)" [disabled]="procesando() === ant.id"
                        class="px-6 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-all">
                  <i class="pi pi-times"></i> Rechazar
                </button>
              </div>

            </div>
          }
        </div>
      }
    </div>
  `
})
export class AdminAntecedentesComponent implements OnInit {
  private antecedentesService = inject(AntecedentesService);
  private tenantService = inject(TenantService);

  pendientes = signal<Antecedente[]>([]);
  cargando = signal(true);
  procesando = signal<string | null>(null);

  ngOnInit() {
    this.cargarPendientes();
  }

  cargarPendientes() {
    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId) return;

    this.cargando.set(true);
    this.antecedentesService.obtenerPendientes(bId).subscribe({
      next: (data) => {
        this.pendientes.set(data);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
  }

  aprobar(ant: Antecedente) {
    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId || !confirm('¿Estás seguro de aprobar este antecedente? Será visible en la ficha médica del cliente.')) return;

    this.procesando.set(ant.id);
    this.antecedentesService.evaluar(bId, ant.id, 'APROBADO').subscribe({
      next: () => {
        this.cargarPendientes();
        this.procesando.set(null);
      },
      error: () => this.procesando.set(null)
    });
  }

  rechazar(ant: Antecedente) {
    const motivo = prompt('Por favor, indica el motivo del rechazo:');
    if (motivo === null) return; // Canceló
    if (!motivo.trim()) {
      alert('El motivo es obligatorio para rechazar.');
      return;
    }

    const bId = this.tenantService.barberiaActiva()?.id;
    if (!bId) return;

    this.procesando.set(ant.id);
    this.antecedentesService.evaluar(bId, ant.id, 'RECHAZADO', motivo).subscribe({
      next: () => {
        this.cargarPendientes();
        this.procesando.set(null);
      },
      error: () => this.procesando.set(null)
    });
  }
}
