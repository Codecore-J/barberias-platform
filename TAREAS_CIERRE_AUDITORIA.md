# Tareas de Cierre — Auditoría Técnica
Plataforma de Gestión de Barberías

**Origen:** Informe de Auditoría Técnica Exhaustiva (13 hallazgos, 12/12 resueltos en código, 1 pendiente de infraestructura).
**Objetivo de este documento:** dejar en tareas atómicas y verificables lo que falta antes de certificar el sistema como listo para producción.
**Cómo usarlo:** cada tarea tiene un ID, es independiente, tiene un criterio de aceptación objetivo y un campo de evidencia. Márcala `[x]` solo cuando la evidencia exista, no cuando "debería funcionar".

---

## Bloque A — Infraestructura (bloqueante de rendimiento)

### TASK-A1 — Confirmar región actual de despliegue de Render
- [ ] **Prioridad:** Alta
- **Acción exacta:** Entrar al dashboard de Render → Settings del servicio backend → confirmar la región configurada.
- **Criterio de aceptación:** Se documenta por escrito la región exacta (ej. Oregon, Frankfurt, etc.).
- **Evidencia requerida:** Captura de pantalla o texto de la configuración.
- **Bloqueante para producción:** No (es diagnóstico).

### TASK-A2 — Migrar el servicio de Render a us-east-2 (Ohio)
- [ ] **Prioridad:** Alta
- **Depende de:** TASK-A1
- **Acción exacta:** Redesplegar o reconfigurar el servicio backend en Render para que corra en la región `us-east-2 (Ohio)`, la misma región del proyecto en Neon.
- **Criterio de aceptación:** El dashboard de Render muestra la región `us-east-2` activa y el servicio responde con normalidad tras el cambio.
- **Evidencia requerida:** Captura de la nueva configuración + confirmación de que el health check (`/health`) sigue devolviendo 200 tras el cambio.
- **Bloqueante para producción:** Sí.

### TASK-A3 — Re-benchmark de latencia post-migración
- [ ] **Prioridad:** Alta
- **Depende de:** TASK-A2
- **Acción exacta:** Repetir exactamente las mismas mediciones de la sección 2.1 y 2.3 del informe original (mismos endpoints, mismo método de medición) después de la migración de región.
- **Criterio de aceptación:** Backend → Neon (SELECT 1) baja de ~157ms a <30ms promedio. Backend → Neon (query con JOIN) baja de ~400ms a <100ms promedio. Si no baja a estos rangos, hay una causa adicional que investigar (DNS, TLS keep-alive, connection pooling).
- **Evidencia requerida:** Tabla comparativa antes/después con los mismos endpoints del informe original.
- **Bloqueante para producción:** Sí.

---

## Bloque B — Higiene del informe (no bloqueante, pero obligatorio antes de archivar)

### TASK-B1 — Resolver colisión de ID `CONF-01`
- [ ] **Prioridad:** Media
- **Acción exacta:** En `AUDITORIA_HALLAZGOS.md`, renombrar el hallazgo de CORS permisivo de `CONF-01` a `CONF-02`, dejando `CONF-01` únicamente para el secreto JWT débil. Actualizar cualquier referencia cruzada (commits, tickets, otros documentos) que mencione el ID viejo.
- **Criterio de aceptación:** El archivo `AUDITORIA_HALLAZGOS.md` no contiene dos hallazgos con el mismo ID.
- **Evidencia requerida:** Diff del commit que aplica el renombrado.
- **Bloqueante para producción:** No.

---

## Bloque C — Decisión de seguridad (requiere tu aprobación, no del agente)

### TASK-C1 — Confirmar que el auto-rehash de bcrypt migra en la dirección correcta
- [ ] **Prioridad:** Alta
- **Acción exacta:** Pedir al agente que muestre el código de `auth.service.ts` donde ocurre el auto-rehash en login, y confirmar explícitamente: si un usuario tiene un hash antiguo de 12 rondas, el sistema lo re-hashea a 10 rondas en su próximo login exitoso (no al revés).
- **Criterio de aceptación:** Confirmación explícita con el fragmento de código relevante, más una prueba manual: crear un usuario con hash de 12 rondas simulado, hacer login, y confirmar en la base de datos que el hash cambió a 10 rondas.
- **Evidencia requerida:** Fragmento de código + resultado de la prueba manual.
- **Bloqueante para producción:** Sí.

### TASK-C2 — Decisión de producto: 10 vs. 11 rondas de bcrypt
- [ ] **Prioridad:** Media
- **Acción exacta:** Esta es tu decisión, no del agente. Con el CPU disponible fuera de picos de login, evalúa si vale la pena subir de 10 a 11 rondas (menor riesgo ante una eventual filtración, costo de CPU moderadamente mayor). Documenta la decisión final y el motivo.
- **Criterio de aceptación:** Una línea documentada en `AUDITORIA_HALLAZGOS.md`: "Se mantiene en 10 rondas por [motivo]" o "Se sube a 11 rondas por [motivo]".
- **Evidencia requerida:** Ninguna técnica — solo la decisión documentada.
- **Bloqueante para producción:** No.

---

## Bloque D — Pruebas críticas de privacidad y negocio (no confirmadas en el informe)

> Estas cuatro pruebas cubren las reglas marcadas como **críticas** desde el primer documento de reglas de negocio. No es opcional confirmarlas, aunque el resultado sea "pasó sin cambios".

### TASK-D1 — Fuga de historial entre barberías
- [ ] **Prioridad:** Crítica
- **Acción exacta:** Con un cliente vinculado a Barbería X y Barbería Y, consultar el historial desde la sesión/token de Barbería Y y confirmar que no aparezca ningún dato (reservas, pagos, notas) que pertenezca a la relación con Barbería X.
- **Criterio de aceptación:** Cero campos de la Barbería X visibles al consultar como Barbería Y.
- **Evidencia requerida:** Petición y respuesta completa (request/response) del endpoint de historial mostrando el aislamiento.
- **Bloqueante para producción:** Sí.

### TASK-D2 — Antecedente compartido no expone origen
- [ ] **Prioridad:** Crítica
- **Acción exacta:** Crear un antecedente en Barbería X, marcarlo para compartir, aprobarlo como admin, y consultarlo desde Barbería Y (vinculada al mismo cliente). Confirmar que la respuesta NO incluya `barberia_origen_id` ni la identidad del barbero que lo creó.
- **Criterio de aceptación:** El JSON de respuesta al consultar desde Barbería Y no contiene esos dos campos ni ningún dato equivalente.
- **Evidencia requerida:** Response completo del endpoint mostrando la ausencia de esos campos.
- **Bloqueante para producción:** Sí.

### TASK-D3 — Detección de dependencia circular en combos
- [ ] **Prioridad:** Alta
- **Acción exacta:** Intentar crear un combo A que contenga a un combo B que a su vez contenga a A (ciclo de 2 niveles). Repetir con un ciclo de 3 niveles (A→B→C→A).
- **Criterio de aceptación:** Ambos intentos son rechazados por el backend antes de persistir, con un error claro (no un 500 genérico).
- **Evidencia requerida:** Request y response de ambos intentos.
- **Bloqueante para producción:** Sí.

### TASK-D4 — Restricción por no-shows es local a la barbería
- [ ] **Prioridad:** Alta
- **Acción exacta:** Provocar 5 no-shows de un cliente en Barbería X hasta que quede restringido. Confirmar que ese mismo cliente pueda seguir reservando normalmente en Barbería Y.
- **Criterio de aceptación:** La restricción existe en `cliente_barberias` solo para la fila de Barbería X; el cliente reserva sin problema en Barbería Y.
- **Evidencia requerida:** Estado de `cliente_barberias` para ambas barberías + prueba de reserva exitosa en Barbería Y.
- **Bloqueante para producción:** Sí.

---

## Bloque E — Pruebas de seguridad no confirmadas

### TASK-E1 — Margen grupal bajo carga concurrente
- [ ] **Prioridad:** Alta
- **Acción exacta:** Disparar 20 solicitudes de reserva GRUPAL concurrentes (distintos horarios, no compitiendo por el mismo slot) y verificar en cada una que `margen_grupal_historico` se haya aplicado exactamente una vez por reserva, nunca por participante.
- **Criterio de aceptación:** En las 20 reservas resultantes, el bloque de tiempo calculado coincide con `suma de duraciones + un solo margen`, sin excepciones.
- **Evidencia requerida:** Tabla con las 20 reservas, sus participantes/servicios, y el cálculo esperado vs. real.
- **Bloqueante para producción:** Sí.

### TASK-E2 — Prueba de IDOR
- [ ] **Prioridad:** Crítica
- **Acción exacta:** Autenticado como Usuario A, cambiar manualmente el ID en la URL de un endpoint que devuelve un recurso (reserva, antecedente, historial) para apuntar a un recurso del Usuario B.
- **Criterio de aceptación:** El backend responde 403/404, nunca devuelve el dato del Usuario B.
- **Evidencia requerida:** Request y response del intento.
- **Bloqueante para producción:** Sí.

### TASK-E3 — Inyección SQL en campos de texto libre
- [ ] **Prioridad:** Alta
- **Acción exacta:** Enviar payloads de inyección SQL clásicos (`' OR '1'='1`, `'; DROP TABLE usuarios; --`, etc.) en los campos `nombre`, `motivo`, `descripcion` de al menos 3 endpoints distintos. Confirmar además que no exista ningún `$queryRawUnsafe` o concatenación de strings en el código para construir queries.
- **Criterio de aceptación:** Ningún payload altera el comportamiento esperado; el dato se guarda como texto literal o se rechaza por validación, nunca se ejecuta como SQL.
- **Evidencia requerida:** Resultado de los intentos + confirmación de revisión de código (grep de `queryRawUnsafe` y concatenación en queries).
- **Bloqueante para producción:** Sí.

### TASK-E4 — JWT con firma manipulada
- [ ] **Prioridad:** Crítica
- **Acción exacta:** Tomar un JWT válido, alterar un carácter de la firma (tercer segmento) y enviarlo a una ruta protegida.
- **Criterio de aceptación:** Rechazo inmediato con 401, sin excepción no controlada en el backend.
- **Evidencia requerida:** Request y response del intento, más confirmación de que no aparece un stack trace en los logs del servidor expuesto al cliente.
- **Bloqueante para producción:** Sí.

---

## Bloque F — Certificación final

### TASK-F1 — Corrida completa de suites tras cerrar los bloques A-E
- [ ] **Prioridad:** Crítica
- **Depende de:** Todas las tareas anteriores marcadas como bloqueantes
- **Acción exacta:** Ejecutar de nuevo la batería unitaria completa y la batería E2E completa.
- **Criterio de aceptación:** 100% de las suites unitarias y E2E pasan, igual o mejor que el resultado original (20/20 suites unitarias, 5/5 suites E2E).
- **Evidencia requerida:** Log completo de la ejecución final.
- **Bloqueante para producción:** Sí.

### TASK-F2 — Actualización final de `AUDITORIA_HALLAZGOS.md`
- [ ] **Prioridad:** Alta
- **Depende de:** TASK-F1
- **Acción exacta:** Agregar una sección final al archivo con la fecha de cierre, el commit de certificación, y la lista de las tareas D1-D4 y E1-E4 con su evidencia enlazada.
- **Criterio de aceptación:** El archivo queda como registro único y completo, sin hallazgos pendientes sin justificar.
- **Evidencia requerida:** El archivo actualizado.
- **Bloqueante para producción:** Sí.

---

## Resumen de bloqueo para producción

| Bloque | Tareas | Bloquea producción |
|---|---|---|
| A — Infraestructura | A1, A2, A3 | Sí |
| B — Higiene del informe | B1 | No |
| C — Decisión de seguridad | C1, C2 | C1 sí, C2 no |
| D — Privacidad y negocio crítico | D1, D2, D3, D4 | Sí (las 4) |
| E — Seguridad | E1, E2, E3, E4 | Sí (las 4) |
| F — Certificación final | F1, F2 | Sí (ambas) |

**No se debe considerar el sistema listo para producción hasta que todas las tareas marcadas "Sí" en la columna de bloqueo estén con evidencia real adjunta.**
