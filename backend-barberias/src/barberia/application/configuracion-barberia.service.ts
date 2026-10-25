import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { ConfiguracionBarberia } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { withSerializableTransaction } from '../../shared/concurrency/serializable-transaction.js';
import type {
  ConfiguracionBarberiaDto,
  ConfiguracionBarberiaResponseDto,
  ModoReserva,
} from './dto/configuracion-barberia.dto.js';
import { ESTADOS } from '../../shared/domain/estados.js';
import { errorDeConflicto, reglaDeNegocio } from '../../shared/errors/d40.errors.js';
import { AuditoriaService } from '../../auditoria/application/auditoria.service.js';
import {
  fechaCalendarioISO,
  TiempoService,
  ZONA_POR_DEFECTO,
} from '../../shared/time/tiempo.service.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';

/** Campos que no pueden cambiar mientras existan reservas en curso (§8.4 E3-11). */
const CAMPOS_BLOQUEADOS_CON_PENDIENTES = [
  'modoReserva',
  'aceptaIndividual',
  'aceptaGrupal',
  'maxPendientes',
] as const;

@Injectable()
export class ConfiguracionBarberiaService {
  private readonly logger = new Logger(ConfiguracionBarberiaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly tiempo: TiempoService = new TiempoService(),
  ) {}

  async getConfiguracion(barberiaId: string): Promise<ConfiguracionBarberiaResponseDto> {
    const config = await this.prisma.configuracionBarberia.findUnique({
      where: { barberiaId },
    });

    if (!config) {
      throw new ForbiddenException('La barbería no tiene configuración.');
    }

    return this.aMapearConfiguracion(config);
  }

  /**
   * Mapeo explícito campo por campo de la entidad Prisma `ConfiguracionBarberia`
   * hacia el DTO de salida. Nunca se devuelve el objeto crudo de la base: así el
   * contrato HTTP queda estable aunque el esquema gane columnas internas
   * (`reactivacion_real`, futuras) y se evita filtrar datos no previstos.
   */
  private aMapearConfiguracion(config: ConfiguracionBarberia): ConfiguracionBarberiaResponseDto {
    return {
      barberiaId: config.barberiaId,
      modoReserva: config.modoReserva as ModoReserva,
      aceptaIndividual: config.aceptaIndividual,
      aceptaGrupal: config.aceptaGrupal,
      maxPendientes: config.maxPendientes,
      maxNinos: config.maxNinos,
      maxPersonasTotal: config.maxPersonasTotal,
      horizonteReservaDias: config.horizonteReservaDias,
      nuevasReservasActivas: config.nuevasReservasActivas,
      margenGrupalMinutos: config.margenGrupalMinutos,
      permiteCancelacionEspecial: config.permiteCancelacionEspecial,
      oportunidadesEspacioActivas: config.oportunidadesEspacioActivas ?? false,
      motivoPausa: config.motivoPausa,
      pausaDesde: config.pausaDesde,
      reactivacionProgramada: config.reactivacionProgramada,
      reactivacionReal: config.reactivacionReal,
    };
  }

  async actualizarConfiguracion(
    barberiaId: string,
    dto: ConfiguracionBarberiaDto,
    usuario: UsuarioAutenticado,
  ): Promise<ConfiguracionBarberiaResponseDto> {
    return withSerializableTransaction(this.prisma, async (tx) => {
      const barberia = await tx.barberia.findUnique({
        where: { id: barberiaId },
      });

      if (!barberia) {
        throw new ForbiddenException('Barbería no encontrada.');
      }

      const config = await tx.configuracionBarberia.findUnique({
        where: { barberiaId },
      });

      if (!config) {
        throw new ForbiddenException('La barbería no tiene configuración.');
      }

      const anterior = this.aMapearConfiguracion(config);

      // ¿Se está intentando tocar algún campo sensible al estado de las reservas?
      const tocaCamposBloqueados = CAMPOS_BLOQUEADOS_CON_PENDIENTES.some(
        (campo) => dto[campo] !== undefined,
      );

      if (tocaCamposBloqueados) {
        // Reservas en curso = PENDIENTE o PROPUESTA_PENDIENTE (§5.1).
        const pendientes = await tx.reserva.count({
          where: {
            barberiaId,
            estado: { in: [ESTADOS.PENDIENTE, ESTADOS.PROPUESTA_PENDIENTE] },
          },
        });

        if (pendientes > 0) {
          // 409 CONFLICT: no se puede modificar la configuración si hay reservas pendientes.
          throw errorDeConflicto(
            'CONFIG_CON_PENDIENTES',
            `No se puede modificar modo_reserva, acepta_individual, acepta_grupal ni max_pendientes porque existen ${pendientes} reserva(s) pendiente(s).`,
            { conteo: pendientes },
          );
        }
      }

      // Validaciones numéricas: límites ≥ 1 sobre los valores enviados.
      if (dto.maxNinos !== undefined && dto.maxNinos < 1) {
        throw reglaDeNegocio('VALIDACION', 'max_ninos debe ser >= 1.', {
          campo: 'max_ninos',
        });
      }

      if (dto.maxPersonasTotal !== undefined && dto.maxPersonasTotal < 1) {
        throw reglaDeNegocio('VALIDACION', 'max_personas_total debe ser >= 1.', {
          campo: 'max_personas_total',
        });
      }

      // Regla estricta: max_personas_total >= max_ninos + 1, porque el total
      // SIEMPRE incluye al adulto responsable. Se compara sobre los valores
      // EFECTIVOS (los del DTO, o los persistidos cuando el campo no viene),
      // de modo que enviar solo uno de los dos no permita dejar un estado
      // inválido combinándolo con el valor actual.
      const maxNinosEfectivo = dto.maxNinos ?? config.maxNinos;
      const maxPersonasTotalEfectivo = dto.maxPersonasTotal ?? config.maxPersonasTotal;

      if (
        maxNinosEfectivo != null &&
        maxPersonasTotalEfectivo != null &&
        maxPersonasTotalEfectivo < maxNinosEfectivo + 1
      ) {
        throw reglaDeNegocio(
          'VALIDACION',
          'max_personas_total debe ser >= max_ninos + 1 (el total incluye al adulto responsable).',
          { maxNinos: maxNinosEfectivo, maxPersonasTotal: maxPersonasTotalEfectivo },
        );
      }

      if (dto.maxPendientes !== undefined && dto.maxPendientes < 1) {
        throw reglaDeNegocio('VALIDACION', 'max_pendientes debe ser >= 1.', {
          campo: 'max_pendientes',
        });
      }

      if (dto.horizonteReservaDias !== undefined && dto.horizonteReservaDias < 1) {
        throw reglaDeNegocio('VALIDACION', 'horizonte_reserva_dias debe ser >= 1.', {
          campo: 'horizonte_reserva_dias',
        });
      }

      if (dto.margenGrupalMinutos !== undefined && dto.margenGrupalMinutos < 0) {
        throw reglaDeNegocio('VALIDACION', 'margen_grupal_minutos debe ser >= 0.', {
          campo: 'margen_grupal_minutos',
        });
      }

      const ahoraTz = this.tiempo.ahora();

      let nuevoMotivoPausa = config.motivoPausa ?? null;
      let nuevaPausaDesde = config.pausaDesde ?? null;
      let nuevaReactivacionProgramada = config.reactivacionProgramada ?? null;

      // Pausa: guarda motivo y pausa_desde (E3-11 §4).
      if (dto.nuevasReservasActivas === false && config.nuevasReservasActivas !== false) {
        if (!dto.motivoPausa || dto.motivoPausa.length < 1) {
          throw reglaDeNegocio('VALIDACION', 'Al pausar es obligatorio enviar motivo_pausa.', {
            campo: 'motivo_pausa',
          });
        }
        nuevoMotivoPausa = dto.motivoPausa;
        nuevaPausaDesde = ahoraTz;
      }

      if (dto.nuevasReservasActivas === true && config.nuevasReservasActivas === false) {
        nuevoMotivoPausa = null;
        nuevaPausaDesde = null;
        nuevaReactivacionProgramada = null;
      }

      // Reactivación programada: 24 h desde el inicio del día en la zona de la sede.
      if (
        dto.nuevasReservasActivas === false &&
        dto.reactivacionMotivo &&
        dto.reactivacionMotivo.length >= 5
      ) {
        const instante = this.tiempo.aInstante(
          fechaCalendarioISO(ahoraTz),
          '00:00',
          ZONA_POR_DEFECTO,
        );
        const reactivacion = new Date(instante.getTime() + 24 * 60 * 60 * 1000);
        nuevaReactivacionProgramada = reactivacion;

        this.logger.log(
          `Programada reactivación automática para barbería ${barberiaId} el ${reactivacion.toISOString()}`,
        );
      }

      const actualizada = await tx.configuracionBarberia.update({
        where: { barberiaId },
        data: {
          modoReserva: dto.modoReserva ?? config.modoReserva,
          aceptaIndividual: dto.aceptaIndividual ?? config.aceptaIndividual,
          aceptaGrupal: dto.aceptaGrupal ?? config.aceptaGrupal,
          maxPendientes: dto.maxPendientes ?? config.maxPendientes,
          horizonteReservaDias: dto.horizonteReservaDias ?? config.horizonteReservaDias,
          nuevasReservasActivas:
            dto.nuevasReservasActivas !== undefined
              ? dto.nuevasReservasActivas
              : config.nuevasReservasActivas,
          margenGrupalMinutos: dto.margenGrupalMinutos ?? config.margenGrupalMinutos,
          permiteCancelacionEspecial:
            dto.permiteCancelacionEspecial !== undefined
              ? dto.permiteCancelacionEspecial
              : config.permiteCancelacionEspecial,
          // E4-02/8 · D22: gobierna el endpoint de huecos; no es un campo
          // bloqueado con pendientes porque no mueve el bloque de nadie.
          oportunidadesEspacioActivas:
            dto.oportunidadesEspacioActivas !== undefined
              ? dto.oportunidadesEspacioActivas
              : config.oportunidadesEspacioActivas,
          maxNinos: dto.maxNinos ?? config.maxNinos,
          maxPersonasTotal: dto.maxPersonasTotal ?? config.maxPersonasTotal,
          motivoPausa: nuevoMotivoPausa,
          pausaDesde: nuevaPausaDesde,
          reactivacionProgramada: nuevaReactivacionProgramada,
        },
      });

      // Auditoría CONFIG_ACTUALIZADA con valor anterior y nuevo.
      await this.auditoria.registrarEvento(
        {
          usuarioId: usuario.id,
          accion: 'CONFIG_ACTUALIZADA',
          entidad: 'configuracion_barberia',
          entidadId: barberiaId,
          contexto: {
            barberiaId,
            anterior: anterior,
            nuevo: this.aMapearConfiguracion(actualizada),
          },
        },
        tx,
      );

      this.logger.log(`Configuración actualizada de barbería ${barberiaId} por ${usuario.id}`);

      return this.aMapearConfiguracion(actualizada);
    });
  }
}
