import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { AdminPersonalComponent } from './admin-personal.component';
import { PersonalService, Personal } from '../../../core/services/personal.service';
import { TenantService } from '../../../core/services/tenant.service';
import { ToastService } from '../../../shared/ui/toast/toast.service';
import { AuthService } from '../../../auth/auth.service';
import { HorariosService } from '../../../core/services/horarios.service';
import { ConfirmDialogService } from '../../../shared/ui/confirm-dialog/confirm-dialog.service';

describe('AdminPersonalComponent', () => {
  let fixture: ComponentFixture<AdminPersonalComponent>;
  let component: AdminPersonalComponent;

  const miembro: Personal = {
    id: 'user-1',
    nombreCompleto: 'Juan Pérez',
    correo: 'juan@example.com',
    telefono: '8095551234',
    estado: 'ACTIVO',
    estadoSede: 'ACTIVO',
    roles: ['BARBERO'],
  };
  const barberia = { id: 'shop-qa', nombre: 'Sede QA' };
  const obtenerPersonal = vi.fn(() => of([miembro]));
  const invitarMiembro = vi.fn((_shopId: string, _dto: any) => of({
    ...miembro,
    id: 'user-2',
    nombreCompleto: 'Ana Gómez',
    correo: 'ana@example.com',
  }));
  const actualizarMiembro = vi.fn((_shopId: string, _userId: string, _dto: any) => of({
    ...miembro,
    nombreCompleto: 'Juan Pérez Actualizado',
    telefono: '8095559876',
    estadoSede: 'INACTIVO' as const,
  }));
  const success = vi.fn();
  const error = vi.fn();

  beforeEach(async () => {
    obtenerPersonal.mockClear();
    invitarMiembro.mockClear();
    actualizarMiembro.mockClear();
    success.mockClear();
    error.mockClear();

    await TestBed.configureTestingModule({
      imports: [AdminPersonalComponent],
      providers: [
        {
          provide: PersonalService,
          useValue: { obtenerPersonal, invitarMiembro, actualizarMiembro },
        },
        {
          provide: TenantService,
          useValue: {
            barberiaActiva: signal(barberia),
            nombreBarberiaActiva: signal(barberia.nombre),
          },
        },
        {
          provide: AuthService,
          useValue: { authState: signal({ user: { roles: ['ADMINISTRADOR'] }, isAuthenticated: true }) },
        },
        { provide: ToastService, useValue: { success, error, warning: vi.fn(), info: vi.fn() } },
        { provide: HorariosService, useValue: { agregarExcepcionBarbero: vi.fn(() => of({})) } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminPersonalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga la lista y abre el modal de invitación desde el botón', () => {
    expect(obtenerPersonal).toHaveBeenCalledWith(barberia.id);
    const button = [...fixture.nativeElement.querySelectorAll('button')]
      .find((element: HTMLButtonElement) => element.textContent?.includes('Invitar Miembro')) as HTMLButtonElement;

    button.click();
    fixture.detectChanges();

    expect(component.formularioPersonalAbierto()).toBe(true);
    expect(component.modoFormulario()).toBe('invitar');
    expect(fixture.nativeElement.textContent).toContain('Invitar miembro de personal');
  });

  it('valida campos requeridos, correo inválido y datos de invitación', () => {
    component.invitarMiembro();
    expect(component.formularioInvitacion.invalid).toBe(true);

    component.formularioInvitacion.patchValue({
      nombreCompleto: 'Ana Gómez',
      correo: 'correo-invalido',
      telefono: '8095551234',
      password: 'password123',
      rolNombre: 'BARBERO',
    });
    expect(component.formularioInvitacion.controls.correo.hasError('email')).toBe(true);
    expect(component.formularioInvitacion.invalid).toBe(true);

    component.formularioInvitacion.patchValue({ correo: 'ana@example.com' });
    expect(component.formularioInvitacion.valid).toBe(true);
  });

  it('envía una invitación válida, cierra el modal y muestra Toast de éxito', () => {
    component.invitarMiembro();
    component.formularioInvitacion.setValue({
      nombreCompleto: ' Ana Gómez ',
      correo: 'ana@example.com',
      telefono: '8095551234',
      password: 'password123',
      rolNombre: 'BARBERO',
    });

    component.guardarInvitacion();

    expect(invitarMiembro).toHaveBeenCalledWith('shop-qa', {
      nombreCompleto: 'Ana Gómez',
      correo: 'ana@example.com',
      telefono: '8095551234',
      password: 'password123',
      rolNombre: 'BARBERO',
    });
    expect(component.personal().some((item) => item.id === 'user-2')).toBe(true);
    expect(component.formularioPersonalAbierto()).toBe(false);
    expect(success).toHaveBeenCalledWith(
      'Ana Gómez ya forma parte del personal de la sede.',
      'Miembro creado',
    );
  });

  it('abre edición desde el botón y carga los datos con sus validaciones', () => {
    const button = fixture.nativeElement.querySelector('[aria-label="Editar datos de Juan Pérez"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(component.formularioPersonalAbierto()).toBe(true);
    expect(component.modoFormulario()).toBe('editar');
    expect(component.formularioEdicion.getRawValue()).toEqual({
      nombreCompleto: 'Juan Pérez',
      telefono: '8095551234',
      estado: 'ACTIVO',
      rolNombre: 'BARBERO',
    });

    component.formularioEdicion.patchValue({ telefono: '123' });
    expect(component.formularioEdicion.controls.telefono.invalid).toBe(true);
    expect(component.formularioEdicion.invalid).toBe(true);
  });

  it('guarda cambios válidos de edición y notifica con Toast', () => {
    component.editarMiembro(miembro);
    component.formularioEdicion.patchValue({
      nombreCompleto: 'Juan Pérez Actualizado',
      telefono: '8095559876',
      estado: 'INACTIVO',
    });

    component.guardarEdicionPersonal();

    expect(actualizarMiembro).toHaveBeenCalledWith('shop-qa', 'user-1', {
      nombreCompleto: 'Juan Pérez Actualizado',
      telefono: '8095559876',
      estado: 'INACTIVO',
      rolNombre: 'BARBERO',
    });
    expect(component.personal()[0]?.estadoSede).toBe('INACTIVO');
    expect(component.formularioPersonalAbierto()).toBe(false);
    expect(success).toHaveBeenCalledWith(
      'Se guardaron los cambios de Juan Pérez Actualizado.',
      'Personal actualizado',
    );
  });
});
