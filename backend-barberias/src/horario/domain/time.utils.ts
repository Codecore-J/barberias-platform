import { BadRequestException } from '@nestjs/common';

export function parseTime(timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date('1970-01-01T00:00:00Z');
  date.setUTCHours(hours, minutes, 0, 0);
  return date;
}

export function validateTimeRange(horaInicio: string, horaFin: string) {
  const inicio = parseTime(horaInicio);
  const fin = parseTime(horaFin);

  if (inicio.getTime() >= fin.getTime()) {
    throw new BadRequestException('horaInicio debe ser menor a horaFin');
  }

  return { inicio, fin };
}
