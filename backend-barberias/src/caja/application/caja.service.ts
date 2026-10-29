import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import { TiempoService, fechaCalendarioISO } from '../../shared/time/tiempo.service.js';
import { esAdministradorGlobalPorId } from '../../iam/domain/roles.js';
import { normalizarMetodo, type MetodoPago } from '../../pago/domain/metodos-pago.js';
import { errorDeConflicto } from '../../shared/errors/d40.errors.js';

export interface TotalesCaja {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  general: number;
  cantidadPagos: number;
}

/**
 * V3 fase 6 · caja del día y cierre.
 *
 * El arqueo NO se recalcula desde `reservas`: se lee de `pagos`, que es la fila
 * del dinero. Solo cuenta `PAGADA`; un cobro `ANULADO` deja de ser ingreso
 * (§7.4) y un `PENDIENTE_DE_PAGO` nunca lo fue.
 *
 * El día es el de la SEDE, no el del servidor: Render corre en UTC y una sede en
 * Santo Domingo cierra su jornada cuatro horas antes del cambio de fecha UTC. Por
 * eso la ventana se compone con `TiempoService.aInstante` sobre
 * `barberias.zona_horaria` (E2-04/H36), nunca con `new Date().setHours(0,0,0,0)`.
 *
 * El cierre es una FOTO: guarda los cuatro totales y no vuelve a mirar la tabla
 * de pagos. Si mañana alguien anula un cobro de ayer, el arqueo de ayer sigue
 * diciendo lo que se contó esa noche, que es justo lo que un arqueo significa.
 */
@Injectable()
export class CajaService {
  private readonly logger = new Logger(CajaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiempo: TiempoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Contexto del día en la zona de la sede: etiqueta, inicio y fin. */
  private ventanaDelDia(zonaHoraria: string) {
    const fecha = this.tiempo.fechaLocal(this.tiempo.ahora(), zonaHoraria);
    const desde = this.tiempo.aInstante(fecha, '00:00', zonaHoraria);
    const hasta = this.tiempo.aInstante(this.tiempo.sumarDias(fecha, 1), '00:00', zonaHoraria);
    return { fecha, desde, hasta };
  }

  /**
   * La caja es de la SEDE: responsable, ADMIN_BARBERIA de esa sede o el
   * ADMINISTRADOR global (D05). Un BARBERO cobra, pero no arquea el turno.
   */
  private async validarGestionSede(usuarioId: string, barberiaId: string) {
    const barberia = await this.prisma.barberia.findUnique({
      where: { id: barberiaId },
      select: { responsableId: true, zonaHoraria: true },
    });

    if (!barberia) {
      throw new NotFoundException('Barbería no encontrada');
    }

    if (barberia.responsableId === usuarioId) return barberia;
    if (await esAdministradorGlobalPorId(this.prisma, usuarioId)) return barberia;

    const rolAdmin = await this.prisma.usuarioRol.findFirst({
      where: {
        usuarioId,
        barberiaId,
        rol: { nombre: 'ADMIN_BARBERIA' },
      },
      select: { id: true },
    });

    if (!rolAdmin) {
      throw new ForbiddenException(
        'Solo el administrador de la sede puede consultar y cerrar su caja',
      );
    }

    return barberia;
  }

  /** Suma los pagos vivos del rango por método normalizado. */
  private sumar(
    pagos: ReadonlyArray<{ monto: unknown; metodoPago: string | null }>,
  ): TotalesCaja {
    const totales: TotalesCaja = {
      efectivo: 0,
      tarjeta: 0,
      transferencia: 0,
      general: 0,
      cantidadPagos: pagos.length,
    };

    for (const pago of pagos) {
      const monto = Number(pago.monto) || 0;
      const metodo: MetodoPago = normalizarMetodo(pago.metodoPago);

      if (metodo === 'TARJETA') totales.tarjeta += monto;
      else if (metodo === 'TRANSFERENCIA') totales.transferencia += monto;
      else totales.efectivo += monto;

      totales.general += monto;
    }

    // Dos decimales: la columna es DECIMAL(12,2) y sumar en coma flotante deja
    // 0.30000000000000004, que el CHECK del cierre rechazaría por el total_general.
    const redondear = (valor: number) => Math.round(valor * 100) / 100;

    return {
      efectivo: redondear(totales.efectivo),
      tarjeta: redondear(totales.tarjeta),
      transferencia: redondear(totales.transferencia),
      general: redondear(totales.general),
      cantidadPagos: totales.cantidadPagos,
    };
  }

  /**
   * `GET /caja/hoy`: totales del día agrupados por método.
   *
   * Si ya hay cierre, devuelve SUS cifras y `estado: 'CERRADO'`. La pantalla no
   * puede enseñar un arqueo que cambia después de haberse sellado.
   */
  async hoy(usuarioId: string, barberiaId: string) {
    const barberia = await this.validarGestionSede(usuarioId, barberiaId);
    const { fecha, desde, hasta } = this.ventanaDelDia(barberia.zonaHoraria);
    const fechaArqueo = this.tiempo.fechaDeCalendario(fecha);

    const cierre = await this.prisma.cierreCaja.findUnique({
      where: { uk_cierre_caja_sede_fecha: { barberiaId, fechaArqueo } },
    });

    if (cierre) {
      return {
        fecha,
        estado: cierre.estado,
        totales: {
          efectivo: Number(cierre.totalEfectivo),
          tarjeta: Number(cierre.totalTarjeta),
          transferencia: Number(cierre.totalTransferencia),
          general: Number(cierre.totalGeneral),
          // El cierre no guarda el conteo: se informa el de sus cifras sin
          // inventar un número que ya no se puede reconstruir con fidelidad.
          cantidadPagos: null as number | null,
        },
        cierre: this.aRespuesta(cierre),
        cerradoAt: cierre.cerradoAt?.toISOString() ?? null,
      };
    }

    const pagos = await this.prisma.pago.findMany({
      where: {
        barberiaId,
        estadoPago: 'PAGADA',
        registradoAt: { gte: desde, lt: hasta },
      },
      select: { monto: true, metodoPago: true },
    });

    return {
      fecha,
      estado: 'ABIERTO',
      totales: this.sumar(pagos),
      cierre: null,
      cerradoAt: null,
    };
  }

  /**
   * `POST /caja/cierre`: congela el día.
   *
   * Doble defensa contra el doble cierre: el `UNIQUE (barberia_id,
   * fecha_arqueo)` de la base y la comprobación dentro de la transacción
   * SERIALIZABLE. Si dos administradores pulsan «cerrar» a la vez, uno gana y el
   * otro recibe 409 con el mensaje D40; nunca nacen dos arqueos del mismo día.
   */
  async cerrar(usuarioId: string, barberiaId: string) {
    const barberia = await this.validarGestionSede(usuarioId, barberiaId);
    const { fecha, desde, hasta } = this.ventanaDelDia(barberia.zonaHoraria);
    const fechaArqueo = this.tiempo.fechaDeCalendario(fecha);

    try {
      return await withSerializableTransaction(this.prisma, async (tx) => {
        const existente = await tx.cierreCaja.findUnique({
          where: { uk_cierre_caja_sede_fecha: { barberiaId, fechaArqueo } },
        });

        if (existente) {
          throw errorDeConflicto(
            'CAJA_YA_CERRADA',
            `La caja del ${fecha} ya fue cerrada.${
              existente.cerradoAt
                ? ` Se selló el ${existente.cerradoAt.toISOString()}.`
                : ''
            }`,
          );
        }

        const pagos = await tx.pago.findMany({
          where: {
            barberiaId,
            estadoPago: 'PAGADA',
            registradoAt: { gte: desde, lt: hasta },
          },
          select: { monto: true, metodoPago: true },
        });

        const totales = this.sumar(pagos);
        const ahora = this.tiempo.ahora();

        const cierre = await tx.cierreCaja.create({
          data: {
            barberiaId,
            fechaArqueo,
            totalEfectivo: totales.efectivo,
            totalTarjeta: totales.tarjeta,
            totalTransferencia: totales.transferencia,
            totalGeneral: totales.general,
            estado: 'CERRADO',
            abiertoPor: usuarioId,
            cerradoPor: usuarioId,
            abiertoAt: ahora,
            cerradoAt: ahora,
          },
        });

        await this.auditoria.registrarEvento(
          {
            usuarioId,
            accion: 'CIERRE_CAJA',
            entidad: 'CIERRE_CAJA',
            entidadId: cierre.id,
            contexto: {
              barberiaId,
              fechaArqueo: fecha,
              totalEfectivo: totales.efectivo,
              totalTarjeta: totales.tarjeta,
              totalTransferencia: totales.transferencia,
              totalGeneral: totales.general,
              cantidadPagos: totales.cantidadPagos,
            },
          },
          tx,
        );

        this.logger.log(
          `Caja ${fecha} cerrada en sede ${barberiaId}: ${totales.general} (${totales.cantidadPagos} pagos)`,
        );

        return {
          fecha,
          estado: cierre.estado,
          totales,
          cierre: this.aRespuesta(cierre),
          cerradoAt: cierre.cerradoAt?.toISOString() ?? null,
        };
      });
    } catch (error) {
      // Carrera entre dos cierres: la transacción serializable puede dejar pasar
      // la lectura y perder en el INSERT contra el UNIQUE. El resultado para
      // quien lo intentó es el mismo que si hubiera visto el cierre: 409.
      if ((error as { code?: string })?.code === 'P2002') {
        throw errorDeConflicto(
          'CAJA_YA_CERRADA',
          `La caja del ${fecha} ya fue cerrada.`,
        );
      }
      throw error;
    }
  }

  private aRespuesta(cierre: {
    id: string;
    barberiaId: string;
    fechaArqueo: Date;
    totalEfectivo: unknown;
    totalTarjeta: unknown;
    totalTransferencia: unknown;
    totalGeneral: unknown;
    estado: string;
    cerradoAt: Date | null;
  }) {
    return {
      id: cierre.id,
      barberiaId: cierre.barberiaId,
      fecha: fechaCalendarioISO(cierre.fechaArqueo),
      estado: cierre.estado,
      totalEfectivo: Number(cierre.totalEfectivo),
      totalTarjeta: Number(cierre.totalTarjeta),
      totalTransferencia: Number(cierre.totalTransferencia),
      totalGeneral: Number(cierre.totalGeneral),
      cerradoAt: cierre.cerradoAt?.toISOString() ?? null,
    };
  }
}
