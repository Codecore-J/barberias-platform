import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { errorDePermiso } from '../../shared/errors/d40.errors.js';
import type { UsuarioAutenticado } from '../../iam/domain/jwt.interface.js';
import {
  LIMITE_INASISTENCIAS_POR_DEFECTO,
  describirEstadoFidelizacion,
} from '../../reserva/domain/fidelizacion.js';

/**
 * E4-03/2 · H54 · lo que el CLIENTE ve de su propia fidelización.
 *
 * Hasta aquí el contador de inasistencias y la restricción existían —los
 * calcula E3-10 y los gestiona la sede— pero el cliente no tenía NINGUNA forma
 * de enterarse: se lo encontraba al intentar reservar y recibir el 403
 * `CLIENTE_RESTRINGIDO`. Este servicio expone su propia fila, en su sede y con
 * el mensaje ya redactado.
 *
 * Reglas que respeta:
 *  - Solo su fila: la sede sale del parámetro de la ruta y el cliente del token,
 *    así que nunca hay datos de otra persona ni de otra sede (D48).
 *  - La regla es una sola: el mensaje no se improvisa aquí, lo proyecta
 *    `describirEstadoFidelizacion` sobre el MISMO contador que usa el cobro de
 *    inasistencias (D47).
 *  - Sin suspender nada: nada de este servicio escribe (y mucho menos
 *    `usuarios.estado_cuenta`, que es decisión manual del ADMINISTRADOR, D48).
 */
export interface MiEstadoDto {
  barberiaId: string;
  clienteId: string;
  /** `ACTIVO`, `PENDIENTE_APROBACION` o `DESVINCULADO` en ESA sede (D10). */
  estadoVinculacion: string;
  contadorNoPresentado: number;
  estaRestringido: boolean;
  motivoRestriccion: string | null;
  /** `true` con 3 o más inasistencias: el perfil muestra la advertencia. */
  advertencia: boolean;
  /** Inasistencias que faltan para que esta sede restrinja. */
  inasistenciasParaRestriccion: number;
  /** El límite que aplica la sede (5 por defecto, §5.8). */
  limiteInasistencias: number;
  /** Texto listo para mostrar, o `null` si no hay nada que avisar. */
  mensaje: string | null;
}

@Injectable()
export class MiEstadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /barberias/:barberiaId/mi-estado`
   *
   * 403 `NO_VINCULADO` cuando no hay fila en `cliente_barberias`: sin vínculo no
   * hay estado que mostrar, y el código es el mismo que ya responde
   * `crearReserva` para un cliente no vinculado (E3-03). No se responde 404 para
   * no distinguir «no estás vinculado» de «esta sede no existe» más de lo que ya
   * hace el resto de la API.
   */
  async obtener(barberiaId: string, solicitante: UsuarioAutenticado): Promise<MiEstadoDto> {
    const vinculo = await this.prisma.clienteBarberia.findUnique({
      where: {
        uk_cliente_barberia: {
          usuarioId: solicitante.id,
          barberiaId,
        },
      },
      select: {
        estadoVinculacion: true,
        contadorNoPresentado: true,
        estaRestringido: true,
        motivoRestriccion: true,
      },
    });

    if (!vinculo) {
      throw errorDePermiso(
        'NO_VINCULADO',
        'No estás vinculado a esta barbería: no hay estado que mostrar.',
      );
    }

    const visible = describirEstadoFidelizacion({
      contadorNoPresentado: vinculo.contadorNoPresentado,
      estaRestringido: vinculo.estaRestringido,
      motivoRestriccion: vinculo.motivoRestriccion,
    });

    return {
      barberiaId,
      clienteId: solicitante.id,
      estadoVinculacion: vinculo.estadoVinculacion,
      contadorNoPresentado: visible.contadorNoPresentado,
      estaRestringido: visible.estaRestringido,
      motivoRestriccion: visible.motivoRestriccion,
      advertencia: visible.advertencia,
      inasistenciasParaRestriccion: visible.inasistenciasParaRestriccion,
      limiteInasistencias: LIMITE_INASISTENCIAS_POR_DEFECTO,
      mensaje: visible.mensaje,
    };
  }
}
