# Fase 5 · Control de tiempo: horarios y descansos del barbero

Rama `feat/v3-horarios-barbero` · PR [#115](https://github.com/Codecore-J/barberias-platform/pull/115).

## Qué cambia

Hasta ahora el motor de disponibilidad solo conocía el horario de la **sede**. Un
barbero que entraba a las 10:00 o almorzaba de 13:00 a 14:00 seguía apareciendo
como disponible a las 09:00 y a la 13:30: el cliente reservaba un hueco que el
barbero no podía atender. Esta fase introduce la **semana propia del barbero**
(días libres, jornada y descanso) y la hace mandar dentro de la jornada de la
sede.

## Base de datos

`prisma/schema.prisma` · `model HorarioBarbero` (tabla `horarios_barbero`):

- `horaInicio` y `horaFin` pasan a **nullable**: un día libre no necesita inventar
  horas.
- Nuevos `horaInicioDescanso`, `horaFinDescanso` (`TIME`, nullable) y `esDiaLibre`
  (`BOOLEAN DEFAULT false`).
- `@@unique([barberiaId, barberoId, diaSemana])` — una sola fila por barbero y día.

Migración `20261029190000_v3_horarios_barbero` con tres garantías a nivel de base:

| Restricción | Regla |
|---|---|
| `horarios_barbero_jornada_check` | Día libre ⇒ sin horas. Día trabajado ⇒ horas completas y `hora_inicio < hora_fin`. |
| `horarios_barbero_descanso_check` | Descanso entero o ninguno, dentro de la jornada y `inicio < fin`. |
| `uk_horario_barbero_dia` | Una fila por `(barberia, barbero, día)`. |

`diaSemana` sigue la convención **ISO** (1 = lunes … 7 = domingo) que ya usan
`TiempoService.diaSemana` y la tabla `horarios` de la sede; cambiar a 0 = domingo
habría obligado a reescribir el motor entero por una diferencia de nomenclatura.

## API

| Verbo | Ruta | Rol | Descripción |
|---|---|---|---|
| `GET` | `/api/v1/shops/:shopId/mi-horario` | `BARBERO` | Devuelve los 7 días y `heredaHorarioSede`. |
| `PUT` | `/api/v1/shops/:shopId/mi-horario` | `BARBERO` | Reemplaza la semana completa. |

- `HorarioBarberoController` aplica `@Roles('BARBERO')` y `VinculoBarberiaGuard`.
- El **`barberoId` nunca viaja** en la ruta ni en el cuerpo: lo pone el JWT
  (`@CurrentUser`). Aceptarlo del cliente dejaría a un barbero reescribir el
  horario de un compañero.
- `PUT` y no `POST` porque el cuerpo es la semana entera: repetir el guardado deja
  el mismo estado y no duplica filas.
- `HorarioService.configurarMiHorario` valida en español (400) duplicados, día
  libre con horas, horas incompletas y descanso fuera de la jornada, y escribe la
  semana en una transacción.
- Las horas salen como `HH:mm` (nunca el ISO de Prisma), que es lo único que
  acepta un `<input type="time">` sin el error `1970-01-01T08:00:00.000Z does not
  conform to HH:mm`.

## Motor de disponibilidad

`DisponibilidadService.calcularDisponibilidad` acepta ahora `barberoId` (opcional):

1. Calcula la jornada de la sede como siempre (horario + excepciones).
2. Si hay `barberoId` y el barbero tiene filas en esa sede:
   - **día libre** ⇒ jornada `null`: cero huecos ese día;
   - si no, la jornada efectiva es la **intersección** de sede y barbero
     (`max(inicios)` / `min(fines)`); sin solape ⇒ jornada `null`;
   - el bloque de descanso se añade a `ocupados`, igual que una reserva, así que
     ningún hueco lo atraviesa.
3. **Compatibilidad:** sin filas del barbero se hereda el horario de la sede, de
   modo que ningún barbero pierde agenda el día del despliegue.

Consumidores actualizados:

- `GET /appointments/schedule/availability` y `POST .../availability/query`
  aceptan `barberoId` (`ConsultarDisponibilidadDto`, `@IsUUID`), para que el
  asistente del cliente pregunte por un barbero concreto.
- `ReservaService`: al crear, reprogramar y aceptar pasa el `barberoId` de la cita
  al motor, así que la revalidación de una reserva también respeta el descanso.

## Frontend

- `BarberoHorariosComponent` reescrito con **`FormArray` de 7 días**:
  - toggle de **Día libre** que deshabilita (y limpia) las horas;
  - inputs `Entrada` / `Salida`;
  - botón **«+ Añadir descanso»** que despliega los dos inputs de almuerzo;
  - validación por día con mensaje en rojo bajo la fila correspondiente;
  - spinner de carga, spinner en el botón de guardar y toast de éxito;
  - errores 400/403 del backend visibles, con botón «Reintentar» en la carga;
  - banner ámbar cuando `heredaHorarioSede` explica de dónde salen las horas.
- `normalizarHora()` convierte `1970-01-01T08:00:00.000Z` / `08:00:00` a `08:00`
  antes de poblar los controles (misma lección que `admin-horarios`).
- `HorariosService`: `obtenerMiSemana` / `guardarMiSemana` contra `/mi-horario`.
- Navbar (escritorio y móvil): enlace **Mi Horario** para el rol `BARBERO`.

## Verificación

| Comando | Resultado |
|---|---|
| `backend npm run lint` | 0 errores (116 warnings preexistentes) |
| `backend npm test` | **79 archivos · 906 tests OK** |
| `frontend npm run lint` | 0 errores |
| `frontend npx ng build` | OK (chunk `barbero-horarios` 17.08 kB) |
| `frontend npm test` | 14 archivos · **120 tests OK** |
| `test/permisos-matriz.spec.ts` | 412 evaluaciones, 0 desviaciones (2 rutas nuevas × 4 roles) |

Tests nuevos de disponibilidad:

- un hueco que cae **dentro del almuerzo** del barbero no se ofrece;
- un día libre del barbero devuelve jornada vacía;
- la intersección recorta cuando el barbero entra más tarde que la sede;
- sin filas del barbero se mantiene la jornada de la sede (compatibilidad).

## Limitación conocida

`npx prisma migrate status` no pudo conectar con Neon (`P1001: Can't reach
database server`), así que la migración **no se aplicó** contra la base remota.
El SQL quedó versionado y se aplica en el pipeline de despliegue.
