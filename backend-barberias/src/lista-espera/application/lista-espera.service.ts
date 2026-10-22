import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { TiempoService } from '../../shared/time/tiempo.service.js';
import { errorDeConflicto, errorDeSolicitud } from '../../shared/errors/d40.errors.js';
import { ESTADOS_LISTA_ESPERA } from '../../shared/domain/estados.js';
import type { CreateListaEsperaDto } from './dto/create-lista-espera.dto.js';

/** Suscripción que se devuelve al cliente: sin datos de otras cuentas. */
const SUSCRIPCION_PUBLICA = {
  id: true,
  barberiaId: true,
  fechaObjetivo: true,
  estado: true,
  creadoAt: true,
  servicios: { select: { id: true, nombre: true } },
} as const;

/**
 * E4-02 · D22 · Carril B: la suscripción a la lista de espera.
 *
 * Aquí solo vive el alta. El matcher que cruza una cancelación con las
 * suscripciones vivas (`PENDIENTE`) y las lleva a `NOTIFICADO` es la pieza
 * siguiente; este servicio no lee huecos ni notifica nada.
 */
@Injectable()
export class ListaEsperaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tiempo: TiempoService,
  ) {}

  /**
   * POST /lista-espera — el cliente se anota a la lista de una sede y fecha.
   *
   * Reglas: la sede tiene que existir, TODOS los servicios tienen que ser de esa
   * sede, y no puede haber dos suscripciones vivas para el mismo cliente, sede y
   * fecha. La del alta es la única escritura: la fila nace `PENDIENTE` y el
   * `CERRADO` que la saca del matcher lo escribe la fase siguiente.
   */
  async suscribirse(usuarioId: string, dto: CreateListaEsperaDto) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: dto.barberiaId },
      select: { id: true },
    });

    if (!barberia) {
      throw new NotFoundException(`No existe la barbería ${dto.barberiaId}.`);
    }

    await this.validarServiciosDeLaSede(dto.barberiaId, dto.servicios);

    const fechaObjetivo = this.tiempo.fechaDeCalendario(dto.fechaObjetivo);

    // Idempotencia por identidad de negocio: una sola suscripción VIVA por
    // cliente/sede/fecha. Las `CERRADO` no cuentan, así que tras vencer o
    // cerrarse la anterior el cliente puede volver a anotarse.
    const vigente = await this.prisma.listaEspera.findFirst({
      where: {
        usuarioId,
        barberiaId: dto.barberiaId,
        fechaObjetivo,
        estado: ESTADOS_LISTA_ESPERA.PENDIENTE,
      },
      select: { id: true },
    });

    if (vigente) {
      throw errorDeConflicto(
        'SUSCRIPCION_DUPLICADA',
        'Ya estás en la lista de espera de esta barbería para esa fecha.',
      );
    }

    return this.prisma.listaEspera.create({
      data: {
        usuarioId,
        barberiaId: dto.barberiaId,
        fechaObjetivo,
        estado: ESTADOS_LISTA_ESPERA.PENDIENTE,
        servicios: { connect: dto.servicios.map((id) => ({ id })) },
      },
      select: SUSCRIPCION_PUBLICA,
    });
  }

  /**
   * Los servicios pedidos tienen que existir Y ser de la sede: la tabla de
   * unión no lleva `barberia_id`, así que sin esta comprobación un cliente
   * podría anotarse a la lista de la sede A pidiendo el catálogo de la sede B y
   * el matcher nunca encontraría el hueco.
   *
   * Un servicio de otra sede se responde como inexistente (400 con el código
   * `SERVICIOS_INVALIDOS`), no como 403: para este cliente, en esta sede, no
   * existe.
   */
  private async validarServiciosDeLaSede(barberiaId: string, servicios: string[]): Promise<void> {
    const encontrados = await this.prisma.servicio.findMany({
      where: { id: { in: servicios }, barberiaId },
      select: { id: true },
    });

    const idsDeLaSede = new Set(encontrados.map((servicio) => servicio.id));
    const desconocidos = servicios.filter((id) => !idsDeLaSede.has(id));

    if (desconocidos.length > 0) {
      throw errorDeSolicitud(
        'SERVICIOS_INVALIDOS',
        `Estos servicios no pertenecen a la barbería: ${desconocidos.join(', ')}.`,
      );
    }
  }
}
