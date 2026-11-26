export class BarberiaResponseDto {
  id: string;
  nombre: string;
  descripcion: string | null;
  telefono: string;
  ubicacion: string;
  /** E3-13 · logo de la sede: edición directa, como descripción y ubicación. */
  logoUrl: string | null;
  // F6 / T-62 · ubicación deducida con Nominatim al crear la sede. Se devuelve
  // para que la pantalla muestre provincia y municipio sin volver a preguntar.
  latitud: number | null;
  longitud: number | null;
  paisCodigo: string | null;
  divisionNivel1: string | null;
  divisionNivel2: string | null;
  direccionCompleta: string | null;
  codigoAcceso: string;
  enlaceUnico: string;
  responsableId: string;
  estado: string;
}
