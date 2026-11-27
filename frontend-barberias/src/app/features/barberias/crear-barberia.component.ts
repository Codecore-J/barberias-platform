import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type {
  MunicipioCatalogo,
  ProvinciaCatalogo,
  UbicacionDeducida,
} from '../../core/services/tenant.service';
import { TenantService } from '../../core/services/tenant.service';

/** Estados posibles de la petición de ubicación al navegador. */
type EstadoUbicacion = 'inactiva' | 'obteniendo' | 'lista' | 'denegada';

@Component({
  selector: 'app-crear-barberia',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="min-h-[85vh] flex items-center justify-center p-4 bg-ambient-mesh transform-style-3d">
      <div class="glass-panel w-full max-w-2xl rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden border border-amber-500/30">

        <!-- Glow 3D -->
        <div class="absolute -top-20 -left-20 w-64 h-64 bg-amber-500/10 rounded-full blur-3x pointer-events-none"></div>

        <div class="relative z-10 space-y-8 transform translate-z-12">

          <!-- Header -->
          <div class="text-center space-y-2">
            <h1 class="text-4xl font-display font-bold text-white">Registrar <span class="gold-gradient-text">Barbería</span></h1>
            <p class="text-zinc-400">Crea tu espacio de trabajo para comenzar a gestionar servicios y agendamientos.</p>
            <!-- H-02: no hay un campo "responsable" en el alta. El backend toma
                 al creador del JWT como responsableId; para designar a otra
                 persona existe el flujo de solicitudes de cambio. -->
            <p class="text-[11px] text-zinc-500">
              La sede quedará a tu nombre como responsable. Para designar a otra persona,
              envía una solicitud de cambio desde la configuración de la sede.
            </p>
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
                    maxlength="150"
                    class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>
                @if (form.get('nombre')?.touched && form.get('nombre')?.invalid) {
                  <p class="text-[11px] text-red-400 pl-1">El nombre debe tener al menos 3 caracteres.</p>
                }
              </div>

              <!-- Teléfono -->
              <div class="space-y-2">
                <label for="sede-telefono" class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Teléfono</label>
                <div class="relative">
                  <i class="pi pi-phone absolute left-4 top-1/2 -translate-y-1/2 text-amber-500"></i>
                  <input type="tel" id="sede-telefono" formControlName="telefono" inputmode="numeric" autocomplete="tel-national"
                    maxlength="10" placeholder="8095550199" (input)="onTelefonoInput($event)"
                    required aria-required="true"
                    [attr.aria-invalid]="campoInvalido('telefono')"
                    [attr.aria-describedby]="campoInvalido('telefono') ? 'sede-telefono-error' : null"
                    class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>
                @if (campoInvalido('telefono')) {
                  <p id="sede-telefono-error" role="alert" class="text-[11px] text-red-400 pl-1">El teléfono debe tener exactamente 10 dígitos.</p>
                }
              </div>

              <!-- Ubicación -->
              <div class="space-y-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Ubicación / Ciudad</label>
                <div class="relative">
                  <i class="pi pi-map-marker absolute left-4 top-1/2 -translate-y-1/2 text-amber-500"></i>
                  <input type="text" formControlName="ubicacion" placeholder="Ej: Calle Duarte 12, Santiago"
                    maxlength="500"
                    class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all shadow-inner">
                </div>

                <!-- F6 / T-66 · confirmación: estos dos nombres los deduce el
                     backend de las coordenadas. Se pueden corregir, pero el alta
                     guarda lo que verificó el servidor, no lo editado aquí. -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div class="space-y-1">
                    <label for="sede-provincia" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Provincia</label>
                    <select id="sede-provincia" formControlName="provincia" (change)="onProvinciaChange()"
                      class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-2 px-3 text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all">
                      <option value="">Sin confirmar</option>
                      @for (provincia of provincias(); track provincia.id) {
                        <option [value]="provincia.nombre">{{ provincia.nombre }}</option>
                      }
                      @for (extra of provinciasExtra(); track extra) {
                        <option [value]="extra">{{ extra }}</option>
                      }
                    </select>
                  </div>
                  <div class="space-y-1">
                    <label for="sede-municipio" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Municipio</label>
                    <select id="sede-municipio" formControlName="municipio" [disabled]="municipios().length === 0"
                      class="w-full bg-zinc-900/80 border border-zinc-700/80 rounded-xl py-2 px-3 text-white disabled:opacity-50 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all">
                      <option value="">Sin confirmar</option>
                      @for (municipio of municipios(); track municipio.nombre) {
                        <option [value]="municipio.nombre">{{ municipio.nombre }}</option>
                      }
                    </select>
                  </div>
                </div>
                <p class="text-[11px] text-zinc-500 pl-1">
                  Provincia y municipio se deducen de tu ubicación exacta. Puedes corregirlos aquí,
                  pero la sede se crea con lo que verifica el servidor.
                </p>
                @if (form.get('ubicacion')?.touched && form.get('ubicacion')?.invalid) {
                  <p class="text-[11px] text-red-400 pl-1">Indica la ubicación o ciudad de la sede.</p>
                } @else if (form.get('ubicacion')?.dirty && !form.get('ubicacion')?.value) {
                  <p class="text-[11px] text-red-400 pl-1">Indica la ubicación o ciudad de la sede.</p>
                }
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

              <!-- F6 · ubicación geográfica obligatoria -->
              <div class="space-y-2 col-span-1 sm:col-span-2">
                <label class="text-xs font-bold text-zinc-400 uppercase tracking-wider pl-1">Ubicación exacta de la sede</label>

                <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <button type="button" data-testid="usar-ubicacion" (click)="usarMiUbicacion()"
                    [disabled]="estadoUbicacion() === 'obteniendo'"
                    class="px-5 py-3 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.25)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                    @if (estadoUbicacion() === 'obteniendo') {
                      <i class="pi pi-spin pi-spinner text-lg"></i> Obteniendo...
                    } @else if (coordenadas()) {
                      <i class="pi pi-refresh text-lg"></i> Actualizar ubicación
                    } @else {
                      <i class="pi pi-map-marker text-lg"></i> Usar mi ubicación
                    }
                  </button>

                  @if (coordenadas(); as coords) {
                    <div class="flex gap-3">
                      <div class="space-y-1">
                        <label for="sede-latitud" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Latitud</label>
                        <input id="sede-latitud" type="text" readonly [value]="coords.latitud"
                          class="w-32 bg-zinc-900/60 border border-zinc-700/60 rounded-xl py-2 px-3 text-zinc-300 text-sm cursor-default focus:outline-none">
                      </div>
                      <div class="space-y-1">
                        <label for="sede-longitud" class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-1">Longitud</label>
                        <input id="sede-longitud" type="text" readonly [value]="coords.longitud"
                          class="w-32 bg-zinc-900/60 border border-zinc-700/60 rounded-xl py-2 px-3 text-zinc-300 text-sm cursor-default focus:outline-none">
                      </div>
                    </div>
                  }
                </div>

                @if (estadoUbicacion() === 'denegada') {
                  <p role="alert" class="text-[11px] text-red-400 pl-1">{{ MENSAJE_PERMISO }}</p>
                } @else if (!coordenadas()) {
                  <p class="text-[11px] text-zinc-500 pl-1">
                    Necesitamos las coordenadas para ubicar la sede: la provincia y el municipio se deducen de ellas.
                  </p>
                }
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
              <button type="submit" [disabled]="form.invalid || isSubmitting() || !coordenadas()"
                class="flex-[2] px-6 py-4 rounded-xl font-bold text-sm text-zinc-950 gold-gradient-bg shadow-[0_10px_30px_rgba(212,175,55,0.3)] hover:shadow-[0_15px_40px_rgba(212,175,55,0.5)] disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-1 transition-all flex items-center justify-center gap-2">
                @if (isSubmitting()) {
                  <i class="pi pi-spin pi-spinner text-lg"></i> Guardando...
                } @else if (!coordenadas()) {
                  <i class="pi pi-map-marker text-lg"></i> Confirma tu ubicación primero
                } @else {
                  <i class="pi pi-check text-lg"></i> Crear Barbería
                }
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  `
})
export class CrearBarberiaComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  protected readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);

  isSubmitting = signal(false);

  /** Estado de la petición de ubicación; la plantilla cambia con él. */
  readonly estadoUbicacion = signal<EstadoUbicacion>('inactiva');

  /** Coordenadas confirmadas; `null` mientras no haya ubicación. */
  readonly coordenadas = signal<{ latitud: number; longitud: number } | null>(null);

  /** Texto literal que pide la fase cuando el navegador niega el permiso. */
  protected readonly MENSAJE_PERMISO =
    'Necesitamos tu ubicación para registrar la sede. Activa los permisos de ubicación en tu navegador.';

  /**
   * Todos los `formControlName` del template viven aquí desde la construcción.
   * Un control ausente hacía que Angular intentara enlazar contra un control
   * `null` y lanzara `Cannot read properties of null (_rawValidators)`.
   *
   * F6 · ya no hay control `logo`: el logo se sube después (T-64).
   */
  form: FormGroup = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(3)]],
    // Mismo contrato que `CreateBarberiaDto`: 10 dígitos exactos, sin formato.
    telefono: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    ubicacion: ['', [Validators.required]],
    descripcion: [''],
    // F6 / T-66 · confirmación de lo que deduce el backend. Editables, pero NO
    // se envían: el alta guarda lo que devolvió Nominatim para las coordenadas.
    provincia: [''],
    municipio: [''],
  });

  /** Catálogo público (`GET /divisiones/DO`), ordenado por el backend. */
  readonly provincias = signal<ProvinciaCatalogo[]>([]);
  readonly municipios = signal<MunicipioCatalogo[]>([]);

  /** Provincia deducida que el catálogo aún no tiene (se ofrece igual). */
  readonly provinciasExtra = signal<string[]>([]);

  ngOnInit(): void {
    this.tenantService.cargarDivisiones('DO').subscribe((catalogo) => {
      this.provincias.set(catalogo.provincias);
    });
  }

  /**
   * El municipio depende de la provincia: al cambiarla se recarga su lista y se
   * limpia el municipio anterior (uno de otra provincia no existe en esta).
   */
  onProvinciaChange(): void {
    const nombre = this.form.get('provincia')?.value as string | undefined;
    const provincia = this.provincias().find((p) => p.nombre === nombre);
    this.municipios.set(provincia?.municipios ?? []);
    this.form.get('municipio')?.setValue('', { emitEvent: false });
  }

  /**
   * F6 / T-66 · confirma la ubicación: pide al backend qué provincia y qué
   * municipio corresponden a las coordenadas y prellena los selects con eso.
   *
   * Un fallo no bloquea el alta: el formulario se queda sin confirmar y el
   * backend volverá a deducirlo al crear la sede.
   */
  private confirmarUbicacion(latitud: number, longitud: number): void {
    this.tenantService.resolverUbicacion(latitud, longitud).subscribe({
      next: (deducida) => {
        if (deducida) this.aplicarDivisiones(deducida);
      },
      error: () => undefined,
    });
  }

  private aplicarDivisiones(deducida: UbicacionDeducida): void {
    const provincia = deducida.divisionNivel1 ?? '';
    const municipio = deducida.divisionNivel2 ?? '';

    const enCatalogo = this.provincias().find((p) => p.nombre === provincia);
    this.provinciasExtra.set(provincia && !enCatalogo ? [provincia] : []);

    const municipios = [...(enCatalogo?.municipios ?? [])];
    if (municipio && !municipios.some((m) => m.nombre === municipio)) {
      municipios.unshift({ id: `deducido:${municipio}`, nombre: municipio });
    }
    this.municipios.set(municipios);

    this.form.patchValue({ provincia, municipio }, { emitEvent: false });
  }

  /** Mismo criterio que los modales de personal: inválido y ya tocado. */
  campoInvalido(nombre: string): boolean {
    const control = this.form.get(nombre);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  /** Solo dígitos y máximo 10: el backend rechaza cualquier otra cosa con 400. */
  onTelefonoInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const limpio = input.value.replace(/\D/g, '').slice(0, 10);
    if (input.value !== limpio) {
      input.value = limpio;
      this.form.get('telefono')?.setValue(limpio, { emitEvent: false });
    }
  }

  /**
   * Pide la posición al navegador. Se redondea a 7 decimales, la precisión de
   * `DECIMAL(10,7)` en la base: así lo que se muestra es lo que se guarda.
   */
  usarMiUbicacion(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.estadoUbicacion.set('denegada');
      return;
    }

    this.estadoUbicacion.set('obteniendo');

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        const latitud = Number(posicion.coords.latitude.toFixed(7));
        const longitud = Number(posicion.coords.longitude.toFixed(7));
        this.coordenadas.set({ latitud, longitud });
        this.estadoUbicacion.set('lista');
        // La confirmación llega después de tener coordenadas: el backend deduce
        // provincia y municipio de ese punto exacto.
        this.confirmarUbicacion(latitud, longitud);
      },
      () => {
        // Permiso denegado, timeout o posición no disponible: para el usuario es
        // lo mismo —sin coordenadas no se crea la sede— y el mensaje le dice
        // qué hacer.
        this.coordenadas.set(null);
        this.estadoUbicacion.set('denegada');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  onSubmit(): void {
    const coords = this.coordenadas();
    if (this.form.invalid || !coords) {
      this.form.markAllAsTouched();
      return;
    }

    // El `ValidationPipe` del backend usa `forbidNonWhitelisted`: se envía solo
    // lo que `CreateBarberiaDto` declara. Provincia y municipio son una
    // CONFIRMACIÓN editable y NO viajan: si se enviaran, el backend los
    // rechazaría (400) y, aunque los aceptara, no son fuente de verdad —la sede
    // guarda lo que devolvió Nominatim, o NULL si no devolvió ese nivel—.
    const { nombre, telefono, ubicacion, descripcion } = this.form.value;

    this.isSubmitting.set(true);
    this.tenantService
      .crearBarberia({
        nombre,
        telefono,
        ubicacion,
        descripcion,
        latitud: coords.latitud,
        longitud: coords.longitud,
      })
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          this.router.navigate(['/barberias']); // Redirigir al Hub donde ya estará activa
        },
        error: () => {
          this.isSubmitting.set(false);
        },
      });
  }
}