import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { AdminCategoriasComponent } from './admin-categorias.component';
import { CatalogoHibridoService } from '../../../core/services/catalogo-hibrido.service';
import { TenantService } from '../../../core/services/tenant.service';
import { AuthService } from '../../../auth/auth.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';

/**
 * T-20/T-21 · la taxonomía es GLOBAL y la gestiona (alta, edición y borrado) el
 * ADMINISTRADOR de plataforma. El ADMIN_BARBERIA conserva la misma pantalla.
 *
 * El borrado solo procede si ningún servicio usa la categoría: cuando el backend
 * responde 409 `CATEGORIA_CON_SERVICIOS` la pantalla dice cuántos servicios la
 * bloquean y ofrece desactivarla, que es el camino normal.
 */
describe('AdminCategoriasComponent · gestión global', () => {
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

  interface Overrides {
    crearCategoria?: unknown;
    actualizarCategoria?: unknown;
    eliminarCategoria?: unknown;
  }

  const crearServicioCatalogo = (overrides: Overrides = {}) => ({
    categorias,
    cargandoCategorias: cargando,
    errorCategorias: error,
    guardandoCategoria: guardando,
    cargarCategorias,
    crearCategoria: vi.fn(() => of(categoria)),
    actualizarCategoria: vi.fn(() => of(categoria)),
    eliminarCategoria: vi.fn(() => of({ id: categoria.id, nombre: categoria.nombre, eliminada: true })),
    ...overrides,
  });

  const crearTenant = (conSede: boolean) => ({
    nombreBarberiaActiva: () => (conSede ? 'Sede QA' : 'Sin Barbería Seleccionada'),
    tieneBarberiaActiva: () => conSede,
    barberiaActivaId: () => (conSede ? 'shop-qa' : null),
  });

  const crearAuth = (roles: string[]) => ({
    authState: () => ({ user: { id: 'u-1', roles } }),
  });

  const confirmar = vi.fn(() => Promise.resolve(true));
  const toastExito = vi.fn();

  async function montar(
    roles: string[],
    conSede = true,
    overrides: Overrides = {},
  ): Promise<ComponentFixture<AdminCategoriasComponent>> {
    await TestBed.configureTestingModule({
      imports: [AdminCategoriasComponent],
      providers: [
        { provide: CatalogoHibridoService, useValue: crearServicioCatalogo(overrides) },
        { provide: TenantService, useValue: crearTenant(conSede) },
        { provide: AuthService, useValue: crearAuth(roles) },
        { provide: ConfirmDialogService, useValue: { confirm: confirmar } },
        { provide: ToastService, useValue: { success: toastExito, error: vi.fn(), warning: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminCategoriasComponent);
    fixture.detectChanges();
    return fixture;
  }

  const texto = (fixture: ComponentFixture<AdminCategoriasComponent>): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const boton = (
    fixture: ComponentFixture<AdminCategoriasComponent>,
    etiqueta: string,
  ): HTMLButtonElement | undefined =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(etiqueta),
    );

  beforeEach(() => {
    cargarCategorias.mockClear();
    confirmar.mockClear();
    toastExito.mockClear();
    error.set(null);
    TestBed.resetTestingModule();
  });

  it('ADMINISTRADOR ve la lista y los controles de alta, edición y borrado', async () => {
    const fixture = await montar(['ADMINISTRADOR']);
    const contenido = texto(fixture);

    expect(contenido).toContain('Corte');
    expect(contenido).toContain('Nueva Categoría');
    expect(boton(fixture, 'Editar')).toBeTruthy();
    expect(boton(fixture, 'Desactivar')).toBeTruthy();
    expect(boton(fixture, 'Eliminar')).toBeTruthy();
    expect(contenido).not.toContain('Solo lectura');
  });

  it('ADMIN_BARBERIA conserva los controles de escritura', async () => {
    const fixture = await montar(['ADMIN_BARBERIA']);
    const contenido = texto(fixture);

    expect(contenido).toContain('Nueva Categoría');
    expect(contenido).toContain('Editar');
    expect(contenido).not.toContain('Solo lectura');
  });

  it('ADMINISTRADOR crea una categoría desde el mismo formulario', async () => {
    const crearCategoria = vi.fn(() => of(categoria));
    const fixture = await montar(['ADMINISTRADOR'], true, { crearCategoria });
    const componente = fixture.componentInstance as any;

    componente.abrirFormulario();
    componente.form.setValue({ nombre: '  Barba  ', descripcion: ' Arreglo de barba ' });
    componente.guardar();

    expect(crearCategoria).toHaveBeenCalledWith({ nombre: 'Barba', descripcion: 'Arreglo de barba' });
    expect(fixture.componentInstance['modalAbierto']()).toBe(false);
  });

  it('ADMINISTRADOR edita una categoría existente', async () => {
    const actualizarCategoria = vi.fn(() => of(categoria));
    const fixture = await montar(['ADMINISTRADOR'], true, { actualizarCategoria });
    const componente = fixture.componentInstance as any;

    componente.abrirFormulario(categoria);
    componente.form.patchValue({ nombre: 'Corte premium' });
    componente.guardar();

    expect(actualizarCategoria).toHaveBeenCalledWith('cat-1', {
      nombre: 'Corte premium',
      descripcion: 'Corte clásico',
    });
  });

  it('elimina una categoría vacía tras confirmar', async () => {
    const eliminarCategoria = vi.fn(() => of({ id: 'cat-1', nombre: 'Corte', eliminada: true }));
    const fixture = await montar(['ADMINISTRADOR'], true, { eliminarCategoria });
    const componente = fixture.componentInstance as any;

    await componente.eliminar(categoria);

    expect(confirmar).toHaveBeenCalled();
    expect(eliminarCategoria).toHaveBeenCalledWith('cat-1');
    expect(toastExito).toHaveBeenCalled();
  });

  it('un 409 muestra cuántos servicios bloquean el borrado y ofrece desactivar', async () => {
    const conflicto = {
      status: 409,
      error: {
        statusCode: 409,
        codigo: 'CATEGORIA_CON_SERVICIOS',
        mensaje: 'No se puede eliminar la categoría «Corte» porque la usan 4 servicio(s).',
        servicios: 4,
      },
    };
    const eliminarCategoria = vi.fn(() => throwError(() => conflicto));
    const actualizarCategoria = vi.fn(() => of(categoria));
    const fixture = await montar(['ADMINISTRADOR'], true, { eliminarCategoria, actualizarCategoria });
    const componente = fixture.componentInstance as any;

    await componente.eliminar(categoria);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('4 servicio');
    const desactivar = boton(fixture, 'Desactivar en su lugar');
    expect(desactivar).toBeTruthy();

    desactivar!.click();
    fixture.detectChanges();

    expect(actualizarCategoria).toHaveBeenCalledWith('cat-1', { activa: false });
    expect(boton(fixture, 'Desactivar en su lugar')).toBeFalsy();
  });

  it('un error distinto del 409 no ofrece desactivar', async () => {
    const eliminarCategoria = vi.fn(() =>
      throwError(() => ({ status: 500, error: { statusCode: 500 } })),
    );
    const fixture = await montar(['ADMINISTRADOR'], true, { eliminarCategoria });
    const componente = fixture.componentInstance as any;

    await componente.eliminar(categoria);
    fixture.detectChanges();

    expect(boton(fixture, 'Desactivar en su lugar')).toBeFalsy();
  });

  it('sin sede activa muestra el mensaje orientador y no consulta la API', async () => {
    const fixture = await montar(['ADMINISTRADOR'], false);

    expect(texto(fixture)).toContain('Selecciona una sede para ver sus categorías');
    expect(cargarCategorias).not.toHaveBeenCalled();
  });
});
