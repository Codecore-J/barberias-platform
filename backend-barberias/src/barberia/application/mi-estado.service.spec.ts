import { Test, TestingModule } from '@nestjs/testing';
import { MiEstadoService } from './mi-estado.service.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { RELOJ, TiempoService } from '../../shared/time/tiempo.service.js';
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
 *
 * E3-12/3 · `desvincular` vive aquí porque es el MISMO recurso (el vínculo del
 * cliente con ESA sede) visto desde el otro lado: lo que antes solo se leía
 * ahora también se puede cerrar, y con las reglas de D20/D21 encima.
 */
describe('MiEstadoService (E4-03/2 · H54 · E3-12/3)', () => {
  const cliente: UsuarioAutenticado = {
    id: 'uuid-cliente',
    correo: 'cliente@test.com',
    roles: ['CLIENTE'],
    rolesDetallados: [{ nombre: 'CLIENTE', barberiaId: null, ambito: 'GLOBAL' }],
  };

  /** Reloj fijo: 2026-10-15T02:00Z son las 22:00 del 14 en Santo Domingo (UTC-4). */
  const AHORA = new Date('2026-10-15T02:00:00.000Z');

  const mockPrisma = {
    clienteBarberia: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    reserva: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  const auditoria = { registrarEvento: vi.fn().mockResolvedValue({ id: 'auditoria-1' }) };

  let service: MiEstadoService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(mockPrisma),
    );
    mockPrisma.reserva.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MiEstadoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditoriaService, useValue: auditoria },
        TiempoService,
        { provide: RELOJ, useValue: () => AHORA },
      ],
    }).compile();

    service = module.get<MiEstadoService>(MiEstadoService);
  });

  const vinculo = (extra: Record<string, unknown> = {}) => ({
    id: 'vinculo-1',
    estadoVinculacion: 'ACTIVO',
    contadorNoPresentado: 0,
    estaRestringido: false,
    motivoRestriccion: null,
    esBarberiaActiva: true,
    ...extra,
  });

  describe('obtener (H54)', () => {
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

  describe('desvincular (E3-12/3)', () => {
    const sede = { nombre: 'Barbería Uno', zonaHoraria: 'America/Santo_Domingo' };

    beforeEach(() => {
      mockPrisma.clienteBarberia.findUnique.mockResolvedValue(vinculo({ barberia: sede }));
      mockPrisma.clienteBarberia.count.mockResolvedValue(4);
    });

    it('sin vinculación no hay nada que cerrar: 403 NO_VINCULADO', async () => {
      mockPrisma.clienteBarberia.findUnique.mockResolvedValue(null);

      await expect(service.desvincular('uuid-barberia', cliente)).rejects.toMatchObject({
        response: { codigo: 'NO_VINCULADO', statusCode: 403 },
      });
      expect(mockPrisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('cerrar dos veces no es idempotente: 409 ESTADO_INVALIDO', async () => {
      mockPrisma.clienteBarberia.findUnique.mockResolvedValue(
        vinculo({ estadoVinculacion: 'DESVINCULADO', barberia: sede }),
      );

      await expect(service.desvincular('uuid-barberia', cliente)).rejects.toMatchObject({
        response: { codigo: 'ESTADO_INVALIDO', statusCode: 409 },
      });
      expect(mockPrisma.clienteBarberia.update).not.toHaveBeenCalled();
    });

    it('acota el cierre al cliente del TOKEN y a la sede de la RUTA', async () => {
      await service.desvincular('uuid-barberia', cliente);

      expect(mockPrisma.clienteBarberia.findUnique).toHaveBeenCalledWith({
        where: {
          uk_cliente_barberia: { usuarioId: 'uuid-cliente', barberiaId: 'uuid-barberia' },
        },
        include: expect.anything(),
      });
    });

    it('con reservas futuras vivas responde 422 RESERVAS_EN_CURSO y no cierra nada', async () => {
      mockPrisma.reserva.findMany.mockResolvedValue([
        {
          id: 'reserva-1',
          estado: 'CONFIRMADA',
          fechaCita: new Date('2026-10-20T00:00:00.000Z'),
          horaInicio: new Date('1970-01-01T14:30:00.000Z'),
        },
      ]);

      await expect(service.desvincular('uuid-barberia', cliente)).rejects.toMatchObject({
        response: {
          codigo: 'RESERVAS_EN_CURSO',
          statusCode: 422,
          conteo: 1,
          reservas: [{ reservaId: 'reserva-1', estado: 'CONFIRMADA', fecha: '2026-10-20', hora: '14:30' }],
        },
      });
      expect(mockPrisma.clienteBarberia.update).not.toHaveBeenCalled();
      expect(auditoria.registrarEvento).not.toHaveBeenCalled();
    });

    it('la ventana de bloqueo son las citas de HOY en la zona de la SEDE, no del servidor', async () => {
      // 2026-10-15T02:00Z = 2026-10-14T22:00 en Santo Domingo: la sede todavía
      // está en el día 14, así que la reserva del 14 SÍ ancla el vínculo.
      await service.desvincular('uuid-barberia', cliente);

      expect(mockPrisma.reserva.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clienteId: 'uuid-cliente',
            barberiaId: 'uuid-barberia',
            estado: { in: ['PENDIENTE', 'PROPUESTA_PENDIENTE', 'CONFIRMADA'] },
            fechaCita: { gte: new Date('2026-10-14T00:00:00.000Z') },
          },
        }),
      );
    });

    it('cierra la fila EN EL SITIO y conserva historial y penalización (D20/D21)', async () => {
      mockPrisma.clienteBarberia.findUnique.mockResolvedValue(
        vinculo({
          contadorNoPresentado: 4,
          estaRestringido: true,
          motivoRestriccion: 'Bloqueo automático: alcanzaste el límite.',
          barberia: sede,
        }),
      );

      const resultado = await service.desvincular('uuid-barberia', cliente);

      expect(mockPrisma.clienteBarberia.update).toHaveBeenCalledWith({
        where: { id: 'vinculo-1' },
        // Solo estos dos campos: nada de reiniciar el contador ni de levantar
        // la restricción de la sede.
        data: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
      });
      expect(resultado).toEqual({
        barberiaId: 'uuid-barberia',
        clienteId: 'uuid-cliente',
        barberiaNombre: 'Barbería Uno',
        estadoVinculacion: 'DESVINCULADO',
        esBarberiaActiva: false,
        vinculacionesVigentes: 4,
      });
    });

    it('audita el cierre con el anterior y el nuevo, en la MISMA transacción', async () => {
      await service.desvincular('uuid-barberia', cliente);

      expect(auditoria.registrarEvento).toHaveBeenCalledWith(
        {
          usuarioId: 'uuid-cliente',
          accion: 'CLIENTE_DESVINCULADO_VOLUNTARIAMENTE',
          entidad: 'cliente_barberias',
          entidadId: 'vinculo-1',
          contexto: {
            barberiaId: 'uuid-barberia',
            clienteId: 'uuid-cliente',
            anterior: { estadoVinculacion: 'ACTIVO', esBarberiaActiva: true },
            nuevo: { estadoVinculacion: 'DESVINCULADO', esBarberiaActiva: false },
          },
        },
        mockPrisma,
      );
    });

    it('devuelve el cupo que D10 recupera: solo cuenta los vínculos VIVOS', async () => {
      await service.desvincular('uuid-barberia', cliente);

      expect(mockPrisma.clienteBarberia.count).toHaveBeenCalledWith({
        where: {
          usuarioId: 'uuid-cliente',
          estadoVinculacion: { not: 'DESVINCULADO' },
        },
      });
    });
  });
});
