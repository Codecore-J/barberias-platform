export class BarberiaResponseDto {
  id: string;
  nombre: string;
  descripcion: string | null;
  telefono: string;
  ubicacion: string;
  /** E3-13 · logo de la sede: edición directa, como descripción y ubicación. */
  logoUrl: string | null;
  codigoAcceso: string;
  enlaceUnico: string;
  responsableId: string;
  estado: string;
}
