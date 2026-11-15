import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminCategoriasComponent } from './admin-categorias.component';
import { CatalogoHibridoService } from '../../../core/services/catalogo-hibrido.service';
import type { CategoriaServicio } from '../../../core/services/catalogo-hibrido.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * T-17 · el ADMINISTRADOR global audita las categorías en SOLO LECTURA.
 *
 * La ruta y el `RolesGuard` dejan entrar a los dos roles, así que lo único que
 * impide que el admin de plataforma edite la taxonomía de una sede es la UI más
 * el 403 del backend. Aquí se fija la mitad de la UI: sin banner no se entiende
 * el porqué, y con botones la pantalla prometería algo que la API rechaza.
 */
describe('AdminCategoriasComponent · T-17 alcance de escritura', () => {
  const CATEGORIAS: CategoriaServicio[] = [
    { id: 'cat-1', nombre: 'Corte', descripcion: 'Clásico', activa: true, serviciosActivos: 3 },
    { id: 'cat-2', nombre: 'Barba', descripcion: 'Afeitado', activa: false, serviciosActivos: 0 },
  ] as CategoriaServicio[];

  let fixture: ComponentFixture<AdminCategoriasComponent>;
  let authState: ReturnType<typeof signal<any>>;

  const texto = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const boton = (etiqueta: string) =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
      b.textContent?.includes(etiqueta),
    );

  function montar(roles: string[]): void {
    authState = signal({ user: { id: 'u1', roles, nombreCompleto: 'Prueba' } });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCategoriasComponent],
      providers: [
        {
          provide: CatalogoHibridoService,
          useValue: {
            categorias: signal<CategoriaServicio[]>(CATEGORIAS),
            cargandoCategorias: signal(false),
            guardandoCategoria: signal(false),
            errorCategorias: signal<string | null>(null),
            cargarCategorias: vi.fn(() => of(CATEGORIAS)),
            crearCategoria: vi.fn(() => of(CATEGORIAS[0])),
            actualizarCategoria: vi.fn(() => of(CATEGORIAS[0])),
          },
        },
        { provide: TenantService, useValue: { nombreBarberiaActiva: () => 'Sede Norte' } },
        { provide: AuthService, useValue: { authState } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(async () => true) } },
        {
          provide: ToastService,
          useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
        },
      ],
    });

    fixture = TestBed.createComponent(AdminCategoriasComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ADMINISTRADOR global: ve el listado, el aviso de solo lectura y ningún botón de escritura', () => {
    montar(['ADMINISTRADOR']);

    const componente = fixture.componentInstance;
    expect(componente.puedeGestionar()).toBe(false);
    expect(componente.soloLectura()).toBe(true);

    // El listado se lee: es el propósito del ticket.
    expect(texto()).toContain('Corte');
    expect(texto()).toContain('Barba');

    const banner = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="banner-solo-lectura"]',
    );
    expect(banner?.textContent).toContain('Modo de solo lectura (Administrador Global)');

    expect(boton('Nueva Categoría')).toBeUndefined();
    expect(boton('Editar')).toBeUndefined();
    expect(boton('Desactivar')).toBeUndefined();
    expect(boton('Reactivar')).toBeUndefined();
    // Y no se le ofrece la columna de acciones.
    expect(texto()).not.toContain('Acciones');
  });

  it('ADMINISTRADOR global: abrir el formulario no hace nada aunque se invoque el método', () => {
    montar(['ADMINISTRADOR']);

    fixture.componentInstance.abrirFormulario(CATEGORIAS[0]);

    expect(fixture.componentInstance.modalAbierto()).toBe(false);
    expect(fixture.componentInstance.editandoId()).toBeNull();
  });

  it('ADMIN_BARBERIA: opera con normalidad y no ve el aviso', () => {
    montar(['ADMIN_BARBERIA']);

    const componente = fixture.componentInstance;
    expect(componente.puedeGestionar()).toBe(true);
    expect(componente.soloLectura()).toBe(false);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="banner-solo-lectura"]'),
    ).toBeNull();
    expect(boton('Nueva Categoría')).toBeDefined();
    expect(boton('Editar')).toBeDefined();
    expect(boton('Desactivar')).toBeDefined();
    expect(texto()).toContain('Acciones');
  });
});
