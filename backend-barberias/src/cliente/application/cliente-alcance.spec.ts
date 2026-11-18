import { ForbiddenException } from '@nestjs/common';
import { ClienteService } from './cliente.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * MAPA-1 · L5: la ficha del cliente y sus notas NO son de la sede, son de quien
 * atiende al cliente. El BARBERO (D16, «vista limitada») solo puede leer y
 * anotar sobre clientes que tienen cita con él en esa sede; el rol de sede
 * (`ADMIN_BARBERIA`, `ADMINISTRADOR`) conserva el acceso completo.
 *
 * El recorte del frontend no cuenta: la comprobación vive en el servicio para
 * que una petición directa a la API reciba 403 igual que la pantalla.
 */
describe('ClienteService · alcance del BARBERO sobre fichas y notas (MAPA-1 · L5)', () => {
  const SEDE = 'aaaaaaaa-1111-4111-8111-111111111111';
  const OTRA_SEDE = 'dddddddd-4444-4444-8444-444444444444';
  const BARBERO_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
  const ADMIN_SEDE_ID = 'eeeeeeee-5555-4555-8555-555555555555';
  const CLIENTE_ID = 'cccccccc-3333-4333-8333-333333333333';
  const NOTA_ID = 'ffffffff-6666-4666-8666-666666666666';

  let service: ClienteService;

  const mockPrisma = {
    usuario: { findUnique: vi.fn() },
    reserva: { findMany: vi.fn(), findFirst: vi.fn() },
    antecedente: { findMany: vi.fn(), create: vi.fn() },
  };

  const usuario = (roles: string[], id: string, sedeDelRol = SEDE): UsuarioAutenticado =>
    ({
      id,
      correo: `${id}@test.com`,
      roles,
      rolesDetallados: roles.map((nombre) => ({
        nombre,
        barberiaId: nombre === 'ADMINISTRADOR' ? null : sedeDelRol,
        ambito: nombre === 'ADMINISTRADOR' ? 'GLOBAL' : 'BARBERIA',
      })),
    }) as UsuarioAutenticado;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.usuario.findUnique.mockResolvedValue({
      id: CLIENTE_ID,
      nombreCompleto: 'Cliente de prueba',
      telefono: '+18090000000',
    });
    mockPrisma.reserva.findMany.mockResolvedValue([]);
    mockPrisma.reserva.findFirst.mockResolvedValue(null);
    mockPrisma.antecedente.findMany.mockResolvedValue([]);
    mockPrisma.antecedente.create.mockResolvedValue({
      id: NOTA_ID,
      contenido: 'Le gusta el degradado bajo',
      creadoAt: new Date('2026-11-17T12:00:00.000Z'),
    });

    service = new ClienteService(mockPrisma as unknown as PrismaService);
  });

  it('niega la ficha de un cliente que nunca pasó por la agenda del barbero', async () => {
    await expect(
      service.obtenerFicha(CLIENTE_ID, SEDE, usuario(['BARBERO'], BARBERO_ID)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Fail-closed también contra la enumeración: no se revela si el cliente
    // existe antes de comprobar la relación.
    expect(mockPrisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.antecedente.findMany).not.toHaveBeenCalled();
  });

  it('el barbero con cita lee la ficha y solo suma sus propias reservas', async () => {
    mockPrisma.reserva.findMany.mockResolvedValue([
      { estado: 'COMPLETADA' },
      { estado: 'CANCELADA' },
    ]);

    const ficha = await service.obtenerFicha(
      CLIENTE_ID,
      SEDE,
      usuario(['BARBERO'], BARBERO_ID),
    );

    expect(mockPrisma.reserva.findMany).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE_ID, barberiaId: SEDE, barberoId: BARBERO_ID },
    });
    expect(ficha).toMatchObject({ id: CLIENTE_ID, totalCitas: 1 });
  });

  it('el ADMIN_BARBERIA sigue viendo cualquier cliente de la sede, sin filtro de barbero', async () => {
    await service.obtenerFicha(CLIENTE_ID, SEDE, usuario(['ADMIN_BARBERIA'], ADMIN_SEDE_ID));

    const where = mockPrisma.reserva.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ clienteId: CLIENTE_ID, barberiaId: SEDE });
  });

  it('una cuenta con BARBERO y ADMIN_BARBERIA en la sede conserva la vista completa', async () => {
    await service.obtenerFicha(
      CLIENTE_ID,
      SEDE,
      usuario(['BARBERO', 'ADMIN_BARBERIA'], ADMIN_SEDE_ID),
    );

    const where = mockPrisma.reserva.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('barberoId');
  });

  it('el ADMINISTRADOR global lee la ficha de cualquier sede', async () => {
    await service.obtenerFicha(CLIENTE_ID, SEDE, usuario(['ADMINISTRADOR'], ADMIN_SEDE_ID));

    const where = mockPrisma.reserva.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('barberoId');
  });

  it('un rol de otra sede no alcanza la ficha: se niega (fail-closed)', async () => {
    await expect(
      service.obtenerFicha(CLIENTE_ID, SEDE, usuario(['BARBERO'], BARBERO_ID, OTRA_SEDE)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockPrisma.reserva.findMany).not.toHaveBeenCalled();
  });

  it('niega la nota de un cliente ajeno al barbero y no escribe nada', async () => {
    await expect(
      service.guardarNota(CLIENTE_ID, SEDE, usuario(['BARBERO'], BARBERO_ID), 'nota'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(mockPrisma.antecedente.create).not.toHaveBeenCalled();
  });

  it('el barbero con cita sí puede anotar sobre su cliente', async () => {
    mockPrisma.reserva.findFirst.mockResolvedValue({ id: 'reserva-1' });

    const nota = await service.guardarNota(
      CLIENTE_ID,
      SEDE,
      usuario(['BARBERO'], BARBERO_ID),
      'Le gusta el degradado bajo',
    );

    expect(mockPrisma.reserva.findFirst).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE_ID, barberiaId: SEDE, barberoId: BARBERO_ID },
      select: { id: true },
    });
    expect(mockPrisma.antecedente.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.antecedente.create.mock.calls[0][0].data).toMatchObject({
      usuarioId: CLIENTE_ID,
      barberiaOrigenId: SEDE,
    });
    expect(nota).toMatchObject({ id: NOTA_ID, contenido: 'Le gusta el degradado bajo' });
  });

  it('el ADMIN_BARBERIA anota sin comprobar la relación con el barbero', async () => {
    await service.guardarNota(
      CLIENTE_ID,
      SEDE,
      usuario(['ADMIN_BARBERIA'], ADMIN_SEDE_ID),
      'nota de la sede',
    );

    expect(mockPrisma.reserva.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.antecedente.create).toHaveBeenCalledTimes(1);
  });
});
