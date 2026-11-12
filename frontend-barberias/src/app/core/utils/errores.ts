import { HttpErrorResponse } from '@angular/common/http';

/**
 * Prioridad alta UI/UX · traducción única de errores a texto de usuario.
 *
 * Los toasts mostraban el mensaje crudo del backend: rutas técnicas
 * (`Cannot GET /api/v1/shops/null/hours`), nombres de excepción de Prisma,
 * `null`/`undefined` y códigos HTTP sueltos. El usuario final no puede hacer
 * nada con eso, y además expone la estructura interna de la API.
 *
 * El orden de resolución es deliberado:
 *
 *  1. mensaje legible del backend — el `mensaje` del contrato D40 es del
 *     DOMINIO y ya viene redactado para el usuario. Además el mismo `codigo` se
 *     reutiliza con textos distintos (`ESTADO_INVALIDO` en reservas y en
 *     vinculaciones), así que pisarlo con una ficha genérica perdería contexto.
 *  2. diccionario por `codigo` — entra cuando no hay mensaje o cuando lo que
 *     llegó es una traza técnica.
 *  3. estado HTTP — para lo que llega sin cuerpo útil.
 *  4. mensaje genérico — nunca se deja pasar el texto original.
 */
export interface MensajeParaUsuario {
  readonly mensaje: string;
  readonly titulo?: string;
}

/** Último recurso: ni el texto ni el estado aportan nada accionable. */
export const MENSAJE_GENERICO: MensajeParaUsuario = {
  mensaje: 'Ocurrió un error inesperado al procesar tu solicitud. Inténtalo de nuevo.',
  titulo: 'Algo salió mal',
};

/**
 * Patrones que delatan texto técnico. Se aplican sobre el mensaje del backend
 * antes de decidir si es apto para pintarse: si coincide con alguno, se
 * descarta y se usa el mensaje por estado.
 */
const PATRONES_TECNICOS: readonly RegExp[] = [
  /\/api\//i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//,
  /cannot\s+(?:get|post|put|patch|delete)/i,
  /\bhttp\s+failure\s+response\b/i,
  /prisma/i,
  /\bP\d{4}\b/,
  /\b(?:type|reference|syntax|range)error\b/i,
  /\bat\s+[\w$.<>]+\s*\(/,
  /\b(?:unique|foreign key)\s+constraint\b/i,
  /\b(?:select|insert into|delete from)\b/i,
  /\bupdate\b[\s\S]*\bset\b/i,
  /\bnull\b/i,
  /\bundefined\b/i,
  /\bNaN\b/,
  /<html|<!doctype/i,
  /\[object object\]/i,
  /\bstack\b/i,
];

/**
 * Diccionario por `codigo` del contrato D40 (§6). Los textos son de producto:
 * dicen qué pasó y qué puede hacer el usuario, sin jerga ni rutas.
 */
export const MENSAJES_POR_CODIGO: Readonly<Record<string, MensajeParaUsuario | undefined>> = {
  ADMIN_PROPIO_ROL: {
    titulo: 'Acción no permitida',
    mensaje: 'No puedes cambiar tu propio rol de administrador. Pídeselo a otro administrador.',
  },
  ANULACION_SOLO_ADMIN: {
    titulo: 'Acción no permitida',
    mensaje: 'Solo un administrador puede anular un cobro. Pídeselo a uno de la sede.',
  },
  BARBERIA_NO_APLICA: {
    titulo: 'Datos inconsistentes',
    mensaje: 'La barbería indicada no aplica para esta operación. Recarga y vuelve a intentarlo.',
  },
  BARBERIA_REQUERIDA: {
    titulo: 'Falta elegir barbería',
    mensaje: 'Elige la barbería con la que quieres operar para continuar.',
  },
  BARBERO_BLOQUEADO: {
    titulo: 'Barbero no disponible',
    mensaje: 'Ese barbero está bloqueado y no puede recibir citas.',
  },
  BARBERO_INACTIVO: {
    titulo: 'Barbero no disponible',
    mensaje: 'Ese barbero está inactivo. Actívalo antes de asignarle citas.',
  },
  BARBERO_NO_PERTENECE_A_SEDE: {
    titulo: 'Barbero no disponible',
    mensaje: 'Ese barbero no pertenece a esta barbería. Elige uno de la sede.',
  },
  BARBERO_OCUPADO: {
    titulo: 'Horario ocupado',
    mensaje: 'El barbero ya tiene una cita en ese horario. Elige otra hora.',
  },
  BARBERO_REQUERIDO: {
    titulo: 'Falta elegir barbero',
    mensaje: 'Elige un barbero para continuar.',
  },
  CAJA_YA_CERRADA: {
    titulo: 'Caja cerrada',
    mensaje: 'La caja de hoy ya está cerrada. Mañana podrás abrirla de nuevo.',
  },
  CANCELACION_ESPECIAL_NO_HABILITADA: {
    titulo: 'Cancelación no disponible',
    mensaje:
      'Esta cita no admite cancelación desde tu cuenta. Habla con la barbería para gestionarla.',
  },
  CAPACIDAD_EXCEDIDA: {
    titulo: 'Sin cupo',
    mensaje: 'Ese horario ya está completo. Elige otro horario o barbero.',
  },
  CATALOGO_AMBIGUO: {
    titulo: 'Falta elegir sede',
    mensaje: 'Hay más de un catálogo posible. Elige la barbería antes de continuar.',
  },
  CATEGORIA_DUPLICADA: {
    titulo: 'Categoría repetida',
    mensaje: 'Ya existe una categoría con ese nombre. Usa otro nombre.',
  },
  CATEGORIA_INACTIVA: {
    titulo: 'Categoría inactiva',
    mensaje: 'Esa categoría está inactiva. Actívala para poder usarla.',
  },
  CEDULA_YA_REGISTRADA: {
    titulo: 'Datos ya registrados',
    mensaje: 'Esa cédula ya está registrada en otra cuenta. Revisa los datos o inicia sesión.',
  },
  CITA_NO_INICIADA: {
    titulo: 'Cobro no disponible',
    mensaje: 'La cita todavía no ha comenzado, así que no puede cobrarse.',
  },
  CLIENTE_RESTRINGIDO: {
    titulo: 'Reservas restringidas',
    mensaje:
      'No puedes reservar en esta barbería porque tienes inasistencias acumuladas. Habla con la sede para resolverlo.',
  },
  CONFLICTO_HORARIO: {
    titulo: 'Horario no disponible',
    mensaje: 'Ese horario se cruza con otro que ya existe. Elige una hora distinta.',
  },
  CORREO_YA_REGISTRADO: {
    titulo: 'Datos ya registrados',
    mensaje: 'Ese correo ya está registrado. Inicia sesión o usa otro correo.',
  },
  DATOS_YA_REGISTRADOS: {
    titulo: 'Datos ya registrados',
    mensaje: 'Esos datos ya están registrados. Revisa la información e inténtalo de nuevo.',
  },
  ESTADO_INVALIDO: {
    titulo: 'El estado ya cambió',
    mensaje:
      'La reserva cambió de estado mientras la procesabas. Recarga la pantalla y vuelve a intentarlo.',
  },
  ESTADO_NO_EDITABLE: {
    titulo: 'Dato no editable',
    mensaje: 'Ese dato no se puede editar directamente. Envíalo como solicitud de cambio.',
  },
  FUERA_DE_HORIZONTE: {
    titulo: 'Fecha no disponible',
    mensaje: 'La fecha está demasiado lejos en el calendario. Elige una fecha más cercana.',
  },
  FUERA_DE_VENTANA: {
    titulo: 'Horario no disponible',
    mensaje: 'Ese horario ya no está disponible. Elige otro.',
  },
  INVITACION_AMBIGUA: {
    titulo: 'Invitación ambigua',
    mensaje: 'Ese código coincide con más de una barbería. Pide el enlace de invitación de la sede.',
  },
  INVITACION_REQUERIDA: {
    titulo: 'Falta la invitación',
    mensaje: 'Necesitas un código de acceso o un enlace de invitación para unirte.',
  },
  MONTO_NO_COINCIDE: {
    titulo: 'Importe incorrecto',
    mensaje: 'El monto no coincide con el total de la cita. Revísalo antes de cobrar.',
  },
  MOTIVO_INVALIDO: {
    titulo: 'Motivo no válido',
    mensaje: 'El motivo indicado no es válido. Elige uno de la lista.',
  },
  MOTIVO_REQUERIDO: {
    titulo: 'Falta el motivo',
    mensaje: 'Escribe el motivo para continuar.',
  },
  NOMBRE_REQUIERE_SOLICITUD: {
    titulo: 'Cambio por solicitud',
    mensaje: 'El nombre de la barbería solo cambia mediante una solicitud aprobada.',
  },
  NO_VINCULADO: {
    titulo: 'Sin vinculación',
    mensaje: 'No tienes una vinculación activa con esta barbería.',
  },
  OTP_ENVIO_FALLIDO: {
    titulo: 'No se pudo enviar el código',
    mensaje: 'No pudimos enviar el código de verificación. Inténtalo de nuevo en un momento.',
  },
  OTP_INVALIDO: {
    titulo: 'Código no válido',
    mensaje: 'El código de verificación no es válido o ya expiró. Pide uno nuevo.',
  },
  PASSWORD_INCORRECTA: {
    titulo: 'Contraseña incorrecta',
    mensaje: 'La contraseña actual no es correcta. Escríbela de nuevo para continuar.',
  },
  PASSWORD_REQUERIDA: {
    titulo: 'Falta la contraseña',
    mensaje: 'Escribe tu contraseña actual para confirmar el cambio.',
  },
  PROPUESTA_EXPIRADA: {
    titulo: 'Propuesta expirada',
    mensaje: 'La propuesta de horario ya expiró. Solicita una nueva.',
  },
  PROPUESTA_PENDIENTE: {
    titulo: 'Propuesta en curso',
    mensaje: 'Ya existe una propuesta de horario pendiente para esta sede.',
  },
  RESERVAS_EN_CURSO: {
    titulo: 'Tienes reservas en curso',
    mensaje:
      'No puedes desvincularte todavía: tienes reservas en curso en esta barbería. Cancélalas o espéralas primero.',
  },
  RESERVAS_PAUSADAS: {
    titulo: 'Reservas pausadas',
    mensaje: 'La barbería tiene las reservas pausadas en este momento. Inténtalo más tarde.',
  },
  RESERVA_AJENA: {
    titulo: 'Reserva de otra persona',
    mensaje: 'Esa reserva pertenece a otra persona, así que no puedes modificarla.',
  },
  RESPONSABLE_INEXISTENTE: {
    titulo: 'Responsable no encontrado',
    mensaje: 'El responsable indicado no existe. Elige otro.',
  },
  SEDE_INACTIVA: {
    titulo: 'Sede inactiva',
    mensaje: 'Esa barbería está inactiva y no admite esta operación.',
  },
  SERVICIOS_REQUERIDOS: {
    titulo: 'Faltan servicios',
    mensaje: 'Añade al menos un servicio para continuar.',
  },
  SERVICIO_BARBERO_DUPLICADO: {
    titulo: 'Servicio ya asignado',
    mensaje: 'Ese barbero ya tiene ese servicio asignado.',
  },
  SERVICIO_FUERA_DE_BARBERIA: {
    titulo: 'Servicio de otra sede',
    mensaje: 'Ese servicio no pertenece a esta barbería.',
  },
  SIN_PROPUESTA: {
    titulo: 'Sin propuesta',
    mensaje: 'No hay ninguna propuesta de horario para esta sede.',
  },
  SIN_RESTRICCION: {
    titulo: 'Sin restricción',
    mensaje: 'Ese cliente no tiene ninguna restricción activa.',
  },
  SOLICITUD_EXPIRADA: {
    titulo: 'Solicitud expirada',
    mensaje: 'La solicitud expiró. Vuelve a enviarla.',
  },
  SOLICITUD_PENDIENTE: {
    titulo: 'Solicitud en curso',
    mensaje: 'Ya tienes una solicitud pendiente de respuesta.',
  },
  SOLO_ADMIN_BARBERIA: {
    titulo: 'Acción reservada',
    mensaje: 'Solo el administrador de la barbería puede hacer esto.',
  },
  TELEFONO_YA_REGISTRADO: {
    titulo: 'Datos ya registrados',
    mensaje: 'Ese teléfono ya está registrado en otra cuenta.',
  },
  ULTIMO_ADMINISTRADOR: {
    titulo: 'Acción no permitida',
    mensaje: 'No puedes quitar el último administrador de la sede.',
  },
  VERIFICACION_TELEFONO_REQUERIDA: {
    titulo: 'Verifica tu teléfono',
    mensaje: 'Verifica tu teléfono antes de continuar.',
  },
  WEBHOOK_NO_CONFIGURADO: {
    titulo: 'Pagos no configurados',
    mensaje: 'La integración de pagos no está configurada todavía. Avisa al administrador.',
  },
  WEBHOOK_SECRETO_INVALIDO: {
    titulo: 'Notificación no válida',
    mensaje: 'La firma de la notificación de pago no es válida.',
  },
};

const SIN_CONEXION: MensajeParaUsuario = {
  titulo: 'Sin conexión',
  mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
};

const SESION: MensajeParaUsuario = {
  titulo: 'Sesión no válida',
  mensaje: 'Tu sesión expiró o las credenciales no son correctas. Vuelve a iniciar sesión.',
};

const SIN_PERMISOS: MensajeParaUsuario = {
  titulo: 'Sin permisos',
  mensaje: 'No tienes permisos para realizar esta acción.',
};

const NO_ENCONTRADO: MensajeParaUsuario = {
  titulo: 'No encontrado',
  mensaje: 'No encontramos lo que buscas. Puede que se haya eliminado o que el enlace ya no sea válido.',
};

const DUPLICADO: MensajeParaUsuario = {
  titulo: 'Datos duplicados',
  mensaje: 'Ya existe un registro con esos datos. Revisa la información e inténtalo de nuevo.',
};

const DEMASIADOS_INTENTOS: MensajeParaUsuario = {
  titulo: 'Demasiados intentos',
  mensaje: 'Hiciste demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.',
};

const ERROR_DEL_SERVIDOR: MensajeParaUsuario = {
  titulo: 'Error del servidor',
  mensaje: 'Tuvimos un problema al procesar tu solicitud. Inténtalo de nuevo en unos minutos.',
};

/**
 * Devuelve el texto saneado, o `null` si no es apto para la interfaz.
 *
 * Normaliza espacios (los mensajes de validación llegan con saltos de línea) y
 * recorta los desmesurados, que rompen el toast.
 */
export function sanitizar(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;

  const limpio = texto.trim().replace(/\s+/g, ' ');
  if (limpio.length < 3) return null;
  if (PATRONES_TECNICOS.some((patron) => patron.test(limpio))) return null;

  return limpio.length > 180 ? `${limpio.slice(0, 177).trimEnd()}…` : limpio;
}

function cuerpoDe(error: unknown): Record<string, unknown> | null {
  const cuerpo = (error as { error?: unknown } | null | undefined)?.error;
  return typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)
    : null;
}

function codigoDe(cuerpo: Record<string, unknown> | null): string | null {
  const codigo = cuerpo?.['codigo'] ?? cuerpo?.['code'];
  return typeof codigo === 'string' && codigo.trim() ? codigo.trim() : null;
}

/** Mensaje del cuerpo que sí se puede pintar, incluido el array de validación. */
function mensajeLegible(cuerpo: Record<string, unknown> | null): string | null {
  const crudo = cuerpo?.['mensaje'] ?? cuerpo?.['message'];

  if (Array.isArray(crudo)) {
    const partes = crudo
      .map((item) => sanitizar(item))
      .filter((item): item is string => item !== null);

    return partes.length > 0 ? partes.join(' · ') : null;
  }

  const directo = sanitizar(crudo);
  if (directo) return directo;

  const envoltorio = cuerpo?.['error'];
  return typeof envoltorio === 'string' ? sanitizar(envoltorio) : null;
}

function porEstado(status: number): MensajeParaUsuario {
  if (status === 0) return SIN_CONEXION;
  if (status === 401) return SESION;
  if (status === 403) return SIN_PERMISOS;
  if (status === 404) return NO_ENCONTRADO;
  if (status === 409) return DUPLICADO;
  if (status === 429) return DEMASIADOS_INTENTOS;
  if (status >= 500) return ERROR_DEL_SERVIDOR;
  return MENSAJE_GENERICO;
}

/** Traducción para los toasts globales. Nunca devuelve texto técnico. */
export function mensajeParaUsuario(error: unknown): MensajeParaUsuario {
  if (!(error instanceof HttpErrorResponse)) return MENSAJE_GENERICO;

  const cuerpo = cuerpoDe(error);

  // Primero el texto del dominio: es el más específico y es el mismo que el
  // usuario lee en el formulario donde ese error aparece en línea.
  const legible = mensajeLegible(cuerpo);
  if (legible) return { mensaje: legible };

  const codigo = codigoDe(cuerpo);
  const porCodigo = codigo ? MENSAJES_POR_CODIGO[codigo] : undefined;
  if (porCodigo) return porCodigo;

  return porEstado(error.status);
}

/**
 * Traducción para los mensajes que se pintan DENTRO de un formulario.
 *
 * Mantiene el `respaldo` contextual del componente (que sabe qué estaba
 * intentando el usuario) cuando el backend no aporta nada legible, y comparte
 * diccionario y saneado con los toasts para no contar dos versiones del mismo
 * error.
 */
export function mensajeDeNegocio(error: unknown, respaldo: string): string {
  const cuerpo = cuerpoDe(error);

  const legible = mensajeLegible(cuerpo);
  if (legible) return legible;

  const codigo = codigoDe(cuerpo);
  const porCodigo = codigo ? MENSAJES_POR_CODIGO[codigo] : undefined;
  if (porCodigo) return porCodigo.mensaje;

  const propio = (error as { message?: unknown } | null | undefined)?.message;
  return sanitizar(propio) ?? respaldo;
}
