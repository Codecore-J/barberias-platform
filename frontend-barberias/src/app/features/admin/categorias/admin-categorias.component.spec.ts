import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminCategoriasComponent } from './admin-categorias.component';
import { CatalogoHibridoService } from '../../../core/services/catalogo-hibrido.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * T-17 · el ADMINISTRADOR global ve las categorías en modo SOLO LECTURA: la
 * lista sí, los botones de escritura no (el backend le responde 403, así que la
 * UI no debe ofrecer lo que la API va a rechazar).
 */
describe('AdminCategoriasComponent · T-17', () => {
  const categoria = {
    id: 'cat-1',
    nombre: 'Corte',
    descripcion: 'Corte clásico',
    activa: true,
    serviciosActivos: 3,
    creadoAt: '2026-11-01T10:00:00.000Z',
  };

  const categorias = signal([categoria]);
  const cargando = signal(false);
  const error = signal<string | null>(null);
  const guardando = signal(false);
  const cargarCategorias = vi.fn(() => of([categoria]));

  const crearServicioCatalogo = () => ({
    categorias,
    cargandoCategorias: cargando,
    errorCategorias: error,
    guardandoCategoria: guardando,
    cargarCategorias,
    crearCategoria: vi.fn(() => of(categoria)),
    actualizarCategoria: vi.fn(() => of(categoria)),
  });

  const crearTenant = (conSede: boolean) => ({
    nombreBarberiaActiva: () => (conSede ? 'Sede QA' : 'Sin Barbería Seleccionada'),
    tieneBarberiaActiva: () => conSede,
    barberiaActivaId: () => (conSede ? 'shop-qa' : null),
  });

  const crearAuth = (roles: string[]) => ({
    authState: () => ({ user: { id: 'u-1', roles } }),
  });

  async function montar(roles: string[], conSede = true): Promise<ComponentFixture<AdminCategoriasComponent>> {
    await TestBed.configureTestingModule({
      imports: [AdminCategoriasComponent],
      providers: [
        { provide: CatalogoHibridoService, useValue: crearServicioCatalogo() },
        { provide: TenantService, useValue: crearTenant(conSede) },
        { provide: AuthService, useValue: crearAuth(roles) },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(() => Promise.resolve(true)) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminCategoriasComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    cargarCategorias.mockClear();
    TestBed.resetTestingModule();
  });

  it('ADMINISTRADOR ve la lista y la etiqueta «Solo lectura», sin botones de escritura', async () => {
    const fixture = await montar(['ADMINISTRADOR']);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Corte');
    expect(texto).toContain('Solo lectura');
    expect(texto).not.toContain('Nueva Categoría');
    expect(texto).not.toContain('Editar');
    expect(texto).not.toContain('Desactivar');
  });

  it('ADMIN_BARBERIA sí ve los botones de escritura', async () => {
    const fixture = await montar(['ADMIN_BARBERIA']);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Nueva Categoría');
    expect(texto).toContain('Editar');
    expect(texto).not.toContain('Solo lectura');
  });

  it('sin sede activa muestra el mensaje orientador y no consulta la API', async () => {
    const fixture = await montar(['ADMINISTRADOR'], false);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Selecciona una sede para ver sus categorías');
    expect(cargarCategorias).not.toHaveBeenCalled();
  });
});
