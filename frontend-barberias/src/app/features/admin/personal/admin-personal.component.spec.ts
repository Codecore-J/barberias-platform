import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
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
  const invitarMiembro = vi.fn((_dto: any) => of({
    ...miembro,
    id: 'user-2',
    nombreCompleto: 'Ana Gómez',
    correo: 'ana@example.com',
  }));
  const actualizarMiembro = vi.fn((_userId: string, dto: any) => of({
    ...miembro,
    estadoSede: dto.estado,
    roles: [dto.rolNombre],
  }));
  const success = vi.fn();
  const error = vi.fn();
  const warning = vi.fn();

  beforeEach(async () => {
    obtenerPersonal.mockClear();
    invitarMiembro.mockClear();
    actualizarMiembro.mockClear();
    success.mockClear();
    error.mockClear();
    warning.mockClear();

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
        { provide: ToastService, useValue: { success, error, warning, info: vi.fn() } },
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
    // H-01: el overlay del modal se porta a `<body>` para escapar de los
    // contextos de apilamiento de la página, así que ya no cuelga de
    // `fixture.nativeElement`. Se comprueba además que esté *visible*: al no
    // desmontarse, la sola presencia del texto no probaría que se abrió.
    const dialogo = [...document.body.querySelectorAll('[role="dialog"]')].find((elemento) =>
      elemento.textContent?.includes('Invitar miembro de personal'),
    );
    expect(dialogo).toBeDefined();
    expect((dialogo!.parentElement as HTMLElement).style.display).toBe('flex');
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
      conservarRolAdministrador: false,
    });

    component.guardarInvitacion();

    // Fase 2 · el flag viaja EXPLÍCITO (false) para que el backend no tenga que
    // interpretar su ausencia.
    expect(invitarMiembro).toHaveBeenCalledWith({
      nombreCompleto: 'Ana Gómez',
      correo: 'ana@example.com',
      telefono: '8095551234',
      password: 'password123',
      rolNombre: 'BARBERO',
      conservarRolAdministrador: false,
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
      estado: 'ACTIVO',
      rolNombre: 'BARBERO',
    });
    // También aquí el contenido vive en el overlay portado a `<body>` (H-01).
    const nombre = document.body.querySelector('#personal-editar-nombre') as HTMLInputElement;
    const telefono = document.body.querySelector('#personal-editar-telefono') as HTMLInputElement;
    expect(nombre.value).toBe('Juan Pérez');
    expect(nombre.readOnly).toBe(true);
    expect(telefono.value).toBe('8095551234');
    expect(telefono.readOnly).toBe(true);
    expect(component.formularioEdicion.contains('nombreCompleto')).toBe(false);
    expect(component.formularioEdicion.contains('telefono')).toBe(false);
  });

  it('envía solo rol y estado locales al guardar la edición y notifica con Toast', () => {
    component.editarMiembro(miembro);
    component.formularioEdicion.patchValue({
      estado: 'INACTIVO',
      rolNombre: 'ADMIN_BARBERIA',
    });

    component.guardarEdicionPersonal();

    expect(actualizarMiembro).toHaveBeenCalledWith('user-1', {
      estado: 'INACTIVO',
      rolNombre: 'ADMIN_BARBERIA',
    });
    expect(component.personal()[0]?.estadoSede).toBe('INACTIVO');
    expect(component.personal()[0]?.roles).toEqual(['ADMIN_BARBERIA']);
    expect(component.formularioPersonalAbierto()).toBe(false);
    expect(success).toHaveBeenCalledWith(
      'Se guardaron los cambios de Juan Pérez.',
      'Personal actualizado',
    );
  });

  // ── Fase 2 · cuenta dual (dueño que corta pelo) ─────────────────────────────

  const miembroAdmin: Personal = {
    id: 'user-admin',
    nombreCompleto: 'Dueño de la Sede',
    correo: 'dueno@example.com',
    telefono: '8095559999',
    estado: 'ACTIVO',
    estadoSede: 'ACTIVO',
    roles: ['ADMIN_BARBERIA'],
  };

  function invitacionValida(extra: Partial<Record<string, unknown>> = {}): void {
    component.formularioInvitacion.setValue({
      nombreCompleto: 'Dueño de la Sede',
      correo: 'dueno@example.com',
      telefono: '8095559999',
      password: 'password123',
      rolNombre: 'BARBERO',
      conservarRolAdministrador: false,
      ...extra,
    });
  }

  it('marca la casilla por defecto cuando el correo ya administra la sede', () => {
    component.personal.set([miembro, miembroAdmin]);
    component.invitarMiembro();

    component.formularioInvitacion.patchValue({ correo: 'dueno@example.com' });
    component.alCambiarCorreoInvitacion();

    expect(component.formularioInvitacion.get('conservarRolAdministrador')?.value).toBe(true);
    expect(component.avisoCuentaAdmin()).toContain('Dueño de la Sede');
  });

  it('no marca la casilla si el correo no pertenece a un administrador', () => {
    component.personal.set([miembro]);
    component.invitarMiembro();

    component.formularioInvitacion.patchValue({ correo: 'juan@example.com' });
    component.alCambiarCorreoInvitacion();

    expect(component.formularioInvitacion.get('conservarRolAdministrador')?.value).toBe(false);
    expect(component.avisoCuentaAdmin()).toBeNull();
  });

  it('envía conservarRolAdministrador: true cuando la casilla está marcada', () => {
    component.invitarMiembro();
    invitacionValida({ conservarRolAdministrador: true });

    component.guardarInvitacion();

    expect(invitarMiembro).toHaveBeenCalledWith(
      expect.objectContaining({
        rolNombre: 'BARBERO',
        conservarRolAdministrador: true,
      }),
    );
  });

  it('no envía el flag al invitar como administrador de sede', () => {
    component.invitarMiembro();
    invitacionValida({ rolNombre: 'ADMIN_BARBERIA' });

    component.guardarInvitacion();

    const enviado = invitarMiembro.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('conservarRolAdministrador');
  });

  it('ROJO: el 409 ADMIN_NO_SE_DEGRADA marca la casilla y explica cómo continuar', () => {
    invitarMiembro.mockReturnValueOnce(
      throwError(() => ({
        status: 409,
        error: {
          statusCode: 409,
          codigo: 'ADMIN_NO_SE_DEGRADA',
          mensaje: 'Esta cuenta administra la sede.',
        },
      })),
    );
    component.invitarMiembro();
    invitacionValida();

    component.guardarInvitacion();

    expect(component.formularioInvitacion.get('conservarRolAdministrador')?.value).toBe(true);
    expect(component.errorPersonal()).toContain('Conservar rol de administrador de la sede');
    expect(component.guardandoPersonal()).toBe(false);
    // El modal sigue abierto para que el usuario corrija y reenvíe.
    expect(component.formularioPersonalAbierto()).toBe(true);
    expect(warning).toHaveBeenCalled();
  });

  it('el 409 SEDE_YA_TIENE_ADMIN nombra al dueño actual y no cierra el modal', () => {
    invitarMiembro.mockReturnValueOnce(
      throwError(() => ({
        status: 409,
        error: {
          statusCode: 409,
          codigo: 'SEDE_YA_TIENE_ADMIN',
          mensaje: 'La sede ya tiene un administrador activo.',
          adminActual: {
            id: 'admin-1',
            correo: 'dueno.actual@test.com',
            nombreCompleto: 'Dueño Actual',
          },
        },
      })),
    );
    component.invitarMiembro();
    invitacionValida({ rolNombre: 'ADMIN_BARBERIA' });

    component.guardarInvitacion();

    expect(component.errorPersonal()).toContain('dueno.actual@test.com');
    expect(component.errorPersonal()).toContain('Dueño Actual');
    expect(component.formularioPersonalAbierto()).toBe(true);
  });
});
