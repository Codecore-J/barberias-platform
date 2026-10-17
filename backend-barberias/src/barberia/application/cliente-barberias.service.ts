import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { ESTADOS_VINCULACION_VISIBLES_AL_CLIENTE } from '../domain/vinculacion.js';

/**
 * H72 · una sede del CLIENTE, tal y como él tiene que verla.
 *
 * Es `BarberiaLecturaDto` (E1-05) más lo que solo el vínculo sabe: el estado de
 * su vinculación y cuál de sus sedes tiene fijada como activa. Sin
 * `codigoAcceso` ni `enlaceUnico`: el cliente ya está dentro, lo que necesita es
 * saber EN QUÉ SEDES ESTÁ y en cuál opera.
 */
export interface SedeDelClienteDto {
  /** Id de la BARBERÍA: es el que el frontend usa para elegir sede y para el track. */
  id: string;
  nombre: string;
  descripcion: string | null;
  telefono: string;
  ubicacion: string;
  logoUrl: string | null;
  responsableId: string;
  /** `ACTIVO` o `INACTIVO`: la sede nunca llega `INACTIVO` por el filtro. */
  estado: string;
  /** `ACTIVO` o `PENDIENTE_APROBACION` (D10): nunca `DESVINCULADO`. */
  estadoVinculacion: string;
  /** `true` en la sede que el cliente fijó con `PATCH /barberias/:id/seleccionar`. */
  esBarberiaActiva: boolean;
}

/**
 * H72 · lectura propia del CLIENTE de sus sedes (`cliente_barberias` por
 * `usuarioId`), la pantalla «Tus Barberías» y el dashboard del cliente.
 *
 * No es el listado de responsables (`findAllByResponsable`): esa ruta filtra por
 * `responsableId` y a un cliente puro le devuelve `[]` aunque tenga vínculos, que
 * es el hueco que H72 cierra.
 *
 * Regla de filtrado del encargo, aplicada EN LA CONSULTA para que no dependa de
 * un post-filtro que alguien pueda reordenar después:
 *  - `estadoVinculacion IN (ACTIVO, PENDIENTE_APROBACION)`: solo vínculos VIVOS.
 *    `DESVINCULADO` queda fuera —la fila y su historial siguen en la base
 *    (D20/D21), pero no es una sede donde el cliente opere—.
 *  - `barberia.estado = 'ACTIVO'`: una sede suspendida (E2-07) no se ofrece como
 *    opción operativa.
 *
 * El acotado por usuario es del SERVICIO y no del guard: la ruta no lleva
 * `:barberiaId`, así que el `RolesGuard` solo filtra el rol y el filtro por
 * token es lo único que impide que un cliente lea los vínculos de otro.
 */
@Injectable()
export class ClienteBarberiasService {
  constructor(private readonly prisma: PrismaService) {}

  async listarSedesDelCliente(usuarioId: string): Promise<SedeDelClienteDto[]> {
    const vinculos = await this.prisma.clienteBarberia.findMany({
      where: {
        usuarioId,
        estadoVinculacion: { in: [...ESTADOS_VINCULACION_VISIBLES_AL_CLIENTE] },
        // `estado` de la sede, no el del vínculo: son columnas distintas. El
        // literal acompaña al resto del módulo (E2-07 usa 'ACTIVO'/'INACTIVO').
        barberia: { estado: 'ACTIVO' },
      },
      include: {
        barberia: {
          select: {
            id: true,
            nombre: true,
            descripcion: true,
            telefono: true,
            ubicacion: true,
            logoUrl: true,
            responsableId: true,
            estado: true,
          },
        },
      },
      orderBy: [{ esBarberiaActiva: 'desc' }, { barberia: { nombre: 'asc' } }],
    });

    return vinculos.map((vinculo) => ({
      id: vinculo.barberia.id,
      nombre: vinculo.barberia.nombre,
      descripcion: vinculo.barberia.descripcion,
      telefono: vinculo.barberia.telefono,
      ubicacion: vinculo.barberia.ubicacion,
      logoUrl: vinculo.barberia.logoUrl,
      responsableId: vinculo.barberia.responsableId,
      estado: vinculo.barberia.estado,
      estadoVinculacion: vinculo.estadoVinculacion,
      esBarberiaActiva: vinculo.esBarberiaActiva,
    }));
  }
}
