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
 * DEF-03 · el servicio no tiene descripción.
 *
 * El formulario ofrecía un campo «Descripción (Opcional)» que el saneado del
 * cuerpo descartaba (`servicios.service.ts`, `cuerpoServicio`): el usuario
 * escribía un texto y el alta lo perdía en silencio. El dueño decidió dejar de
 * mostrar el campo, así que aquí se fija que ni existe en el formulario ni
 * viaja en el payload.
 */
describe('AdminServiciosComponent · alta sin descripción (DEF-03)', () => {
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

  it('el formulario de servicio no tiene campo de descripción', () => {
    abrirFormulario();

    expect(texto().querySelector('#servicio-descripcion')).toBeNull();
    expect(texto().querySelector('[formControlName="descripcion"]')).toBeNull();
    expect(fixture.componentInstance.form.get('descripcion')).toBeNull();
  });

  it('el payload de creación no incluye descripcion', () => {
    abrirFormulario();
    const form = fixture.componentInstance.form;
    form.patchValue({ nombre: 'Corte QA', precio: 20, duracionMinutos: 30 });

    fixture.componentInstance.onSubmit();

    expect(servicios.crearServicio).toHaveBeenCalledTimes(1);
    const payload = servicios.crearServicio.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('descripcion');
    expect(payload).toMatchObject({ nombre: 'Corte QA', precio: 20 });
  });
});
