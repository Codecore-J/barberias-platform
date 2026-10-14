import { Test, TestingModule } from '@nestjs/testing';
import { MiEstadoService } from './mi-estado.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  LIMITE_INASISTENCIAS_POR_DEFECTO,
  UMBRAL_ADVERTENCIA_INASISTENCIAS,
} from '../../reserva/domain/fidelizacion.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/**
 * E4-03/2 · H54 · el cliente ve su contador, su advertencia y su restricción.
 *
 * El caso clave es el aislamiento: la lectura se acota con el usuario del TOKEN
 * y la sede de la RUTA, y sin fila en `cliente_barberias` no hay 404 con datos:
 * hay 403 `NO_VINCULADO`.
 */
describe('MiEstadoService (E4-03/2 · H54)', () => {
  const cliente: UsuarioAutenticado = {
    id: 'uuid-cliente',
    correo: 'cliente@test.com',
    roles: ['CLIENTE'],
    rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
  };

  const mockPrisma = {
    clienteBarberia: { findUnique: vi.fn() },
  };

  let service: MiEstadoService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MiEstadoService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<MiEstadoService>(MiEstadoService);
  });

  const vinculo = (extra: Record<string, unknown> = {}) => ({
    estadoVinculacion: 'ACTIVO',
    contadorNoPresentado: 0,
    estaRestringido: false,
    motivoRestriccion: null,
    ...extra,
  });

  it('ROJO: sin vinculación → 403 NO_VINCULADO', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(null);

    await expect(service.obtener('uuid-barberia', cliente)).rejects.toMatchObject({
      response: { codigo: 'NO_VINCULADO', statusCode: 403 },
    });
  });

  it('acota la lectura al cliente del TOKEN y a la sede de la RUTA', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(vinculo());

    await service.obtener('uuid-barberia', cliente);

    expect(mockPrisma.clienteBarberia.findUnique).toHaveBeenCalledWith({
      where: {
        uk_cliente_barberia: { usuarioId: 'uuid-cliente', barberiaId: 'uuid-barberia' },
      },
      select: expect.anything(),
    });
  });

  it('por debajo del umbral no hay aviso que mostrar', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(vinculo({ contadorNoPresentado: 2 }));

    const estado = await service.obtener('uuid-barberia', cliente);

    expect(estado).toMatchObject({
      contadorNoPresentado: 2,
      advertencia: false,
      estaRestringido: false,
      inasistenciasParaRestriccion: LIMITE_INASISTENCIAS_POR_DEFECTO - 2,
      mensaje: null,
      limiteInasistencias: LIMITE_INASISTENCIAS_POR_DEFECTO,
    });
  });

  it('con 3 inasistencias avisa sin restringir (advertencia = true)', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(
      vinculo({ contadorNoPresentado: UMBRAL_ADVERTENCIA_INASISTENCIAS }),
    );

    const estado = await service.obtener('uuid-barberia', cliente);

    expect(estado).toMatchObject({
      advertencia: true,
      estaRestringido: false,
      contadorNoPresentado: 3,
      inasistenciasParaRestriccion: 2,
    });
    expect(estado.mensaje).toBe('Estás a 2 inasistencias de ser suspendido en esta barbería.');
  });

  it('a UNA inasistencia del límite el mensaje va en singular', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(vinculo({ contadorNoPresentado: 4 }));

    const estado = await service.obtener('uuid-barberia', cliente);

    expect(estado.inasistenciasParaRestriccion).toBe(1);
    expect(estado.mensaje).toBe('Estás a 1 inasistencia de ser suspendido en esta barbería.');
  });

  it('restringido: el mensaje es el motivo que guardó la sede', async () => {
    const motivo = 'Bloqueo automático: alcanzaste el límite de 5 inasistencias en esta barbería.';
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(
      vinculo({ contadorNoPresentado: 5, estaRestringido: true, motivoRestriccion: motivo }),
    );

    const estado = await service.obtener('uuid-barberia', cliente);

    expect(estado).toMatchObject({
      estaRestringido: true,
      advertencia: true,
      motivoRestriccion: motivo,
      mensaje: motivo,
      inasistenciasParaRestriccion: 0,
    });
  });

  it('el estado devuelve la vinculación de ESA sede, nunca la cuenta global', async () => {
    mockPrisma.clienteBarberia.findUnique.mockResolvedValue(
      vinculo({ estadoVinculacion: 'PENDIENTE_APROBACION' }),
    );

    const estado = await service.obtener('uuid-barberia', cliente);

    expect(estado.estadoVinculacion).toBe('PENDIENTE_APROBACION');
    // La respuesta habla de la sede y del vínculo; de la cuenta del usuario no
    // se filtra nada (ni `estadoCuenta`, ni correo, ni identificadores ajenos).
    expect(Object.keys(estado).sort()).toEqual(
      [
        'advertencia',
        'barberiaId',
        'clienteId',
        'contadorNoPresentado',
        'estadoVinculacion',
        'estaRestringido',
        'inasistenciasParaRestriccion',
        'limiteInasistencias',
        'mensaje',
        'motivoRestriccion',
      ].sort(),
    );
  });
});
