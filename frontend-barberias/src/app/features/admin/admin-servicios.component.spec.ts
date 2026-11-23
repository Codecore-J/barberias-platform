import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminServiciosComponent } from './admin-servicios.component';
import { ServiciosService } from '../../core/services/servicios.service';
import { TenantService } from '../../core/services/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogService } from '../../shared/ui/confirm-dialog/confirm-dialog.service';

/**
 * T-22 · la descripción vuelve al servicio (revierte DEF-03).
 *
 * DEF-03 quitó el campo del formulario porque la API lo rechazaba y el texto se
 * descartaba en silencio. Ahora el contrato del servicio la admite: el formulario
 * la ofrece como opcional con tope de 500 y viaja en el payload de alta y de
 * edición.
 */
describe('AdminServiciosComponent · descripción del servicio (T-22)', () => {
  let fixture: ComponentFixture<AdminServiciosComponent>;
  let servicios: {
    servicios: ReturnType<typeof signal>;
    isLoading: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    cargarServicios: ReturnType<typeof vi.fn>;
    crearServicio: ReturnType<typeof vi.fn>;
    actualizarServicio: ReturnType<typeof vi.fn>;
  };

  const texto = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    servicios = {
      servicios: signal([]),
      isLoading: signal(false),
      error: signal(null),
      cargarServicios: vi.fn(() => of([])),
      crearServicio: vi.fn(() => of({})),
      actualizarServicio: vi.fn(() => of({})),
    };

    TestBed.configureTestingModule({
      imports: [AdminServiciosComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ServiciosService, useValue: servicios },
        { provide: TenantService, useValue: { nombreBarberiaActiva: () => 'Sede QA' } },
        {
          provide: AuthService,
          useValue: { authState: signal({ user: { roles: ['ADMIN_BARBERIA'] } }) },
        },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(AdminServiciosComponent);
    fixture.detectChanges();
  });

  function abrirFormulario(): void {
    const boton = Array.from(texto().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Nuevo Servicio'),
    );
    expect(boton).toBeTruthy();
    boton!.click();
    fixture.detectChanges();
  }

  it('el formulario tiene el campo de descripción con tope de 500', () => {
    abrirFormulario();

    const campo = texto().querySelector('#servicio-descripcion') as HTMLTextAreaElement | null;
    expect(campo).toBeTruthy();
    expect(campo!.getAttribute('maxlength')).toBe('500');
    expect(fixture.componentInstance.form.get('descripcion')).toBeTruthy();
  });

  it('rechaza una descripción de más de 500 caracteres', () => {
    abrirFormulario();
    const control = fixture.componentInstance.form.get('descripcion')!;

    control.setValue('x'.repeat(501));

    expect(control.invalid).toBe(true);
  });

  it('el payload de creación incluye la descripción', () => {
    abrirFormulario();
    fixture.componentInstance.form.patchValue({
      nombre: 'Corte QA',
      precio: 20,
      duracionMinutos: 30,
      descripcion: 'Tijera y máquina',
    });

    fixture.componentInstance.onSubmit();

    expect(servicios.crearServicio).toHaveBeenCalledTimes(1);
    const payload = servicios.crearServicio.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ nombre: 'Corte QA', descripcion: 'Tijera y máquina' });
  });

  it('al editar, el formulario se rellena con la descripción del servicio', () => {
    fixture.componentInstance.openForm({
      id: 's1',
      nombre: 'Corte QA',
      descripcion: 'Texto guardado',
      precio: 20,
      duracionMinutos: 30,
      esCombo: false,
      barberiaId: 'b1',
      fechaCreacion: '',
    } as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.get('descripcion')?.value).toBe('Texto guardado');
  });
});
