# Plan Estratégico de Arquitectura y Ejecución Ticket por Ticket
## Plataforma de Barberías — Domain-Driven Design (DDD) Defensivo

Este documento define la **estrategia de ingeniería contra la reescritura de código ("código sobre código")** y la minimización de errores en el ciclo de vida del proyecto.

---

## 1. Diagnóstico: ¿Por qué ocurre la reescritura de código en proyectos DDD?

1. **Ausencia de Shared Kernel temprano:** Se implementan controladores y servicios de negocio antes de tener el filtro global de excepciones (ej. `40001` de PostgreSQL), decoradores de contexto (`@CurrentUser`, `@CurrentBarberia`, `@Roles`) y utilitarios de transacciones concurrentes. Al llegar a Reservas, hay que reescribir todo lo anterior.
2. **Violación de límites de Bounded Contexts:** Un módulo consulta directamente modelos de Prisma que pertenecen conceptualmente a otro contexto (ej. Reservas consultando directamente `Horario` o `ComboItem` sin pasar por un puerto de dominio o servicio de aplicación).
3. **Manejo tardío de concurrencia:** Intentar aplicar `SERIALIZABLE` y `SELECT ... FOR UPDATE` después de haber escrito lógica simple con `prisma.findFirst()` y `prisma.create()`.
4. **Desconexión DTO Backend ↔ Interfaces Frontend:** Diseñar pantallas en Angular con estructuras inventadas que luego sufren roturas masivas al conectarse a la API real.

---

## 2. Grafo de Dependencias Acíclicas (DAG de Arquitectura)

Para evitar reescribir código, la ejecución debe seguir estrictamente este orden de capas. **Ningún nivel superior puede implementarse sin que sus dependencias inferiores estén 100% probadas y congeladas.**

```mermaid
graph TD
    classDef shared fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef epic fill:#0f172a,stroke:#a855f7,stroke-width:2px,color:#fff;
    classDef core fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#fff;

    SK[Shared Kernel: Filtro 40001, Decoradores, TransactionHelper]::shared --> IAM[Épica 1: IAM & Auth]::epic
    IAM --> BARBERIA[Épica 2: Barberías & Vinculación Tenancy]::epic
    BARBERIA --> CATALOGO[Épica 3: Catálogo Servicios y Combos DFS]::epic
    BARBERIA --> HORARIOS[Épica 4: Horarios, Excepciones & BullMQ Slots]::epic
    
    CATALOGO --> RESERVAS[Épica 5: Reservas Concurrencia SERIALIZABLE]::core
    HORARIOS --> RESERVAS
    BARBERIA --> RESERVAS
    IAM --> RESERVAS
    
    RESERVAS --> PAGOS[Épica 6: Pagos e Historial Inmutable]::epic
    RESERVAS --> ANTECEDENTES[Épica 7: Antecedentes & Privacidad]::epic
    RESERVAS --> TRANSVERSALES[Épica 8: Notificaciones & Auditoría Purge]::epic
```

---

## 3. Cimientos Técnicos Transversales (Shared Kernel Defensivo)

Para blindar el código desde el día 1, implementamos estos componentes en `backend-barberias/src/shared/`:

### A. Filtro Global de Conflictos de Serialización (`PrismaExceptionFilter`)
* **Código PostgreSQL `40001` (Serialization Failure)** y Prisma `P2034` (Transaction failed due to a write conflict or a deadlock).
* **Mapeo automático a `HTTP 409 Conflict`** con payload semántico:
  ```json
  {
    "statusCode": 409,
    "error": "Conflict",
    "message": "Conflicto de concurrencia detectado. El horario o recurso solicitado fue tomado simultáneamente. Por favor, reintente.",
    "code": "CONCURRENCY_CONFLICT"
  }
  ```
* **Mapeo de `P2002` (Unique Constraint)** a `HTTP 409 Conflict`.
* **Mapeo de `P2025` (Record Not Found)** a `HTTP 404 Not Found`.

### B. Helper Transaccional con Reintentos (`withSerializableTransaction`)
* Abstracción reutilizable para ejecutar transacciones con nivel `Prisma.TransactionIsolationLevel.Serializable`.
* Algoritmo de reintento automático con backoff exponencial aleatorizado (jitter) hasta 3 intentos antes de arrojar `ConflictException`.
* Evita que el desarrollador tenga que escribir lógica de reintento en cada caso de uso.

### C. Sistema de Autorización Multitenant y Scopes de Barbería
* La tabla `UsuarioRol` contempla `barberiaId` nullable. Un usuario puede ser `ADMIN` o `BARBERO` solo dentro de una barbería particular, o `CLIENTE` globalmente.
* Decoradores reutilizables estándar:
  - `@Roles('ADMIN', 'BARBERO', 'CLIENTE')`
  - `@RequireBarberiaScope()`
  - `@CurrentUser()` y `@CurrentBarberiaId()`

---

## 4. Matriz de Ejecución Ticket por Ticket (Hoja de Ruta Estratégica)

### 📌 ÉPICA 1: IAM (Identity & Access Management) — *Sprint Actual*

| Ticket | Entregable Concreto | Regla Anti-Rotura |
| :--- | :--- | :--- |
| **T1.5** (Completado) | Controller REST `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/me`. Tests unitarios (auth.controller.spec.ts, auth.service.spec.ts) y e2e (auth.e2e-spec.ts). | Decorador `@Public()` aplicado a login/register. Extracción segura de usuario mediante `@CurrentUser()` sin leaks de `passwordHash`. |
| **T1.6** (Completado) | Angular Auth: Componentes Standalone, reactive forms, validación defensiva en UI espejo del DTO, `AuthService` con `signal()` de sesión y `AuthInterceptor` funcional. | Tipado estricto idéntico a DTOs de backend para evitar refactorizar formularios después. |

---

### 📌 ÉPICA 2: Bounded Context — Barberías y Vinculación (COMPLETADA)
*Dependencia previa: Épica 1 terminada.*

* **T2.1 Creación y configuración de barberías: (Completado)**
  - Código de acceso y enlace único generados mediante funciones criptográficas no predecibles.
  - Generación de QR único asociado a la URL de la barbería.
  - Responsable asignado con rol `ADMIN_BARBERIA` en `UsuarioRol` con `barberiaId` correspondiente.
* **T2.2 Vinculación de clientes: (Completado)**
  - Regla defensiva: Conteo estricto de vinculaciones activas (`COUNT(*) <= 5`).
  - La 6ª vinculación genera un estado de solicitud pendiente con aprobación explícita del administrador.
* **T2.3 Garantía de una sola barbería activa por cliente: (Completado)**
  - Transacción atómica: al activar una barbería (`esBarberiaActiva = true`), se apaga cualquier otra vinculación activa previa del usuario en la misma transacción (`UPDATE cliente_barberias SET es_barberia_activa = false WHERE usuario_id = $1 AND id != $2`).

---

### 📌 ÉPICA 3: Bounded Context — Catálogo (Servicios y Combos) (COMPLETADA)
*Dependencia previa: Épica 2.*

* **T3.1 CRUD de servicios con regla de desactivación protegida: (Completado)**
  - No permitir eliminación física (`DELETE`), solo soft-delete o cambio de estado a `INACTIVO`.
  - Validación defensiva: Si existen reservas futuras `PENDIENTE` o `CONFIRMADA` con este servicio, denegar desactivación o emitir alerta con lista de citas afectadas.
* **T3.2 Algoritmo de detección recursiva de ciclos en combos (A → B → C → A): (Completado)**
  - Implementación de algoritmo DFS (Depth First Search) con detección de ciclos dirigidos sobre el grafo de combos y subcombos.
  - Función de dominio pura: 100% test unitario con árboles simples, multinivel, grafos acíclicos válidos y grafos cíclicos con rechazo inmediato (`BadRequestException`).
* **T3.3 CRUD de combos con duraciones y márgenes propios: (Completado)**
  - Validación de que la duración propia y margen propio sean mayores que cero y cumplan con los topes de negocio.

---

### 📌 ÉPICA 4: Bounded Context — Horarios y Disponibilidad
*Dependencia previa: Épica 2 y Épica 3.*

* **T4.1 Horarios por día y excepciones (Cerrada / Horario Especial): (Completado)**
  - Validación de solapamiento en horarios base (`horaInicio < horaFin`).
  - Prioridad de excepciones: Una `ExcepcionHorario` sobreescribe el horario recurrente del día de la semana.
* **T4.2 Bloqueos de agenda con jobs en BullMQ: (Completado)**
  - Crear bloqueo manual por parte del barbero/administrador.
  - Job en BullMQ programado para liberar o reactivar bloqueos temporales.
* **T4.3 Motor de cálculo de disponibilidad en tiempo real: (Completado)**
  - Algoritmo de proyección de intervalos (Time Slots).
  - Cálculo de margen grupal: Se aplica un único margen confirmado al final del bloque de servicios agrupados, no márgenes redundantes por cada servicio individual.

---

### 📌 ÉPICA 5: Bounded Context — Reservas y Concurrencia (El Núcleo Crítico)
*Dependencia previa: Épicas 1, 2, 3 y 4.*

* **T5.1 Motor transaccional `SERIALIZABLE` + `SELECT ... FOR UPDATE`: (Completado)**
  - Bloqueo pesimista del rango de disponibilidad de la barbería en la fecha solicitada para evitar condiciones de carrera (Race Conditions).
  - Verificación atómica contra bloqueos y reservas concurrentes activas.
* **T5.2 Manejador de conflicto 40001 → HTTP 409: (Completado)**
  - Verificación mediante tests de estrés concurrentes (Vitest con `Promise.all` de 10 reservas simultáneas sobre el mismo slot exacto). Exactamente 1 debe triunfar con `201 Created` y 9 deben responder `409 Conflict`.
* **T5.3 Flujo manual (timer 10 min en BullMQ) vs automático: (Completado)**
  - Si `modoConfirmacion === 'MANUAL'`, se fija `expira_at = NOW() + 10m` en servidor y se encola un job con delay de 10 minutos en BullMQ.
  - Si el job se dispara y el estado sigue `PENDIENTE`, la reserva pasa automáticamente a `EXPIRADA` y el cupo se libera de inmediato.
* **T5.4 Reglas de inasistencias: (Completado)**
  - Contador defensivo `contadorNoPresentado`: Al llegar a 3 inasistencias → advertencia en perfil. Al llegar a 5 → flag `estaRestringido = true` automático con bloqueo local en esa barbería.
* **QA & Security Hardening (Auditoría Exhaustiva Completada):**
  - Corrección de conciliación de fechas reales vs año base 1970 en `ReservaService`.
  - Validación de bloqueo activo `estaRestringido` y estado de barbería `nuevasReservasActivas` antes de crear citas.
  - Protección de endpoint `/inasistencia` con validación de permisos de responsable/admin.
  - Validación de entradas numéricas y colecciones no vacías en `CreateReservaDto`.
  - Creación de `ConsultarDisponibilidadDto` tipado con validaciones estrictas de fecha y duración.
  - Corrección de fallback seguro en `generateSlug` ante caracteres especiales y emojis.
  - Corrección visual y de validación en campo teléfono de `RegisterComponent`.
  - 56 pruebas unitarias automáticas aprobadas al 100%.

---

### 📌 ÉPICA 6: Bounded Context — Pagos e Historial
*Dependencia previa: Épica 5.*

* **T6.1 Registro de pago en persona: (Completado)**
  - Estados atómicos: `PENDIENTE_DE_PAGO` / `null` → `PAGADA`.
  - Reserva transiciona atómicamente a `COMPLETADA` bajo aislamiento `SERIALIZABLE`.
  - Registro inmutable en tabla `auditoria` asociando usuario cobrador, monto, método y contexto de la cita.
  - Validación de roles autorizados (`ADMIN_BARBERIA`, `BARBERO`, `SUPER_ADMIN` o responsable directo).
  - Validaciones de negocio: rechazo si la cita está `CANCELADA`, `NO_ASISTIO`, `EXPIRADA` o ya fue `PAGADA`.
* **T6.2 Historial inmutable con snapshot: (Completado)**
  - Congelación transaccional de `precioHistorico`, `duracionHistorica` y `margenHistorico` en `ParticipanteServicio` y `totalPagar` en `Reserva` calculados directamente del catálogo activo de la barbería.
  - Validación de existencia y pertenencia de todos los servicios al tenant de la barbería.
  - Validación de coherencia temporal: la duración de la cita debe cubrir la suma total de duraciones de los servicios.
  - Endpoint `GET /barberias/:barberiaId/reservas/:id` para consultar el desglose inmutable de la cita con participantes, catálogo snapshot y registro de pago.

---

### 📌 ÉPICA 7: Bounded Context — Antecedentes y Privacidad
*Dependencia previa: Épica 5 y Épica 1.*

* **T7.1 Creación y flujo de aprobación de antecedentes: (Completado)**
  - Registro de observaciones técnicas/conductuales por barberos o administradores en estado inicial `PENDIENTE`.
  - Flujo de ciclo de vida administrativo: `PENDIENTE` → `APROBADO` / `RECHAZADO` (con motivo de rechazo obligatorio).
  - Control de acceso por roles: Barbero puede crear y consultar antecedentes del cliente; solo Administrador de la barbería o `SUPER_ADMIN` puede evaluar decisiones.
  - Endpoints expuestos: creación, evaluación de dictamen, listado de pendientes y consulta por cliente.
* **T7.2 Anonimización estricta inter-barberías: (Completado)**
  - Consulta multi-tenant cruzada: antecedentes propios se muestran íntegros; antecedentes de otras barberías solo se incluyen si `compartido === true` y `estadoValidacion === 'APROBADO'`.
  - Enmascaramiento irreversible de datos personales (PII) mediante `anonymizer.utils`: nombres compuestos enmascarados (`J*** P***`), correos enmascarados (`ju***@domain.com`) y teléfonos anonimizados (`*******1234`).
  - Ocultación del ID de barbería externa (`barberiaOrigenId: null`) y reemplazo del nombre por `'Red de Barberías (Aliada)'` para evitar fugas de información inter-establecimientos.

---

### 📌 ÉPICA 8: Servicios Transversales (Notificaciones, Auditoría y Reportes)
*Dependencia previa: Todas las épicas operativas.*

* **T8.1 Colas de notificación (BullMQ): (Completado)**
  - Cola `notificaciones` configurada con BullMQ con política de reintentos exponencial (3 intentos).
  - Despacho asíncrono de notificación inmediata (`RESERVA_CONFIRMADA` o `RESERVA_CREADA`) tras agendar cita.
  - Job programado con delay exacto de recordatorio 1 hora antes de la cita (`fechaCita + horaInicio - 1h`).
  - `NotificacionProcessor` procesa despachos y valida que la cita siga activa antes de emitir el recordatorio.
  - Endpoint `GET /api/v1/notificaciones/mis-notificaciones` para consultar notificaciones del cliente.
* **T8.2 Job diario de purga de auditoría: (Completado)**
  - Job recurrente distribuido configurado en BullMQ con cron diario a las 03:00 AM (`0 3 * * *`).
  - Purga automática en `AuditoriaService` de registros que superen los 365 días de antigüedad (`creadoAt < NOW() - 365d`).
  - Worker `AuditoriaProcessor` garantizando que exactamente un contenedor del clúster ejecute la purga sin bloqueos de concurrencia.
  - Endpoints administrativos en `AuditoriaController`: `GET /api/v1/auditoria/estadisticas` y `POST /api/v1/auditoria/purgar` protegidos para `SUPER_ADMIN`.

---

## 5. Estructura de Directorios Estandarizada (Clean Architecture / DDD)

### Backend (`backend-barberias/src/`):
```text
src/
├── shared/                       <-- SHARED KERNEL (Defensivo, cero dependencias de negocio)
│   ├── prisma/                   <-- PrismaService
│   ├── filters/                  <-- PrismaExceptionFilter (40001 -> 409, P2002 -> 409)
│   ├── concurrency/              <-- withSerializableTransaction() helper con reintentos
│   ├── decorators/               <-- @CurrentUser, @CurrentBarberia, @Roles
│   ├── guards/                   <-- RolesGuard, BarberiaScopeGuard
│   └── queues/                   <-- BullMQ constantes de colas centralizadas
│
├── iam/                          <-- Bounded Context: Autenticación e Identidad
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── barberias/                    <-- Bounded Context: Barberías y Vinculaciones
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── catalogo/                     <-- Bounded Context: Servicios y Combos (DFS)
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
├── horarios/                     <-- Bounded Context: Horarios, Excepciones y Slots
├── reservas/                     <-- Bounded Context: Motor de Concurrencia y Transacciones
├── pagos/                        <-- Bounded Context: Cobros y Snapshot Financiero
├── antecedentes/                 <-- Bounded Context: Notas y Anonimización
└── transversales/                <-- Notificaciones, Jobs de Purga, Auditoría
```

### Frontend (`frontend-barberias/src/app/`):
```text
src/app/
├── core/                         <-- Singletons, AuthState (Signals), HTTP Interceptor
│   ├── auth/
│   │   ├── services/auth.service.ts
│   │   ├── guards/auth.guard.ts
│   │   └── interceptors/auth.interceptor.ts
│   └── models/                   <-- Interfaces espejo exactas de los DTOs de NestJS
│       ├── usuario.model.ts
│       └── auth-response.model.ts
│
├── shared/                       <-- Componentes UI reutilizables (PrimeNG wrappers, alerts)
│
└── features/                     <-- Vistas organizadas por Bounded Context
    ├── auth/                     <-- Login & Registro Standalone
    ├── barberias/
    ├── catalogo/
    ├── agenda/
    └── reservas/
```

## 6. Estado de los Pasos Iniciales y Próxima Fase

### Pasos Iniciales Ejecutados y Validados:
1. **[x] Robustecer el Shared Kernel (Prevención Técnica): (Completado)**
   - Filtro global `PrismaExceptionFilter` implementado en `backend-barberias/src/shared/filters/prisma-exception.filter.ts` interceptando `40001`, `P2034`, `P2002`, `P2025`, `P2003`.
   - Registrado globalmente en `main.ts` con `app.useGlobalFilters(new PrismaExceptionFilter())`.
   - Helper `withSerializableTransaction` implementado con reintentos exponenciales para transacciones `SERIALIZABLE`.
2. **[x] Completar Ticket T1.5: (Completado)**
   - `backend-barberias/src/iam/infrastructure/auth.controller.ts` implementado con rutas `/register`, `/login` y `/me`.
   - Pruebas unitarias de autenticación y protección con JWT validadas.
3. **[x] Iniciar Ticket T1.6: (Completado)**
   - Tailwind CSS y PrimeNG configurados en Angular 19.
   - Vistas Standalone de Login y Registro con `signal` reactivo y `AuthInterceptor` integradas.

### Próxima Fase Inmediata: Frontend Integral & Smoke Test E2E
1. **[x] Validación E2E en Vivo: (Completado)**
   - Smoke test automatizado implementado en `test/smoke-test-live.ts` (`npm run test:smoke`).
   - Recorre el flujo de negocio completo de principio a fin de forma transaccional contra la API activa con éxito en sus 13 pasos.

2. **Desarrollo de Vistas Frontend (Angular Standalone + PrimeNG + Tailwind CSS):**

#### 🌌 Requisito Visual: Desplazamiento 3D Inmersivo y Dinámico
- **Motor Espacial con Profundidad Z:** Contenedores con perspectiva 3D (`perspective: 1200px`, `transform-style: preserve-3d`) donde las capas visuales navegan en diferentes planos de profundidad (`translateZ`), generando un efecto parallax espacial hiperrealista al scrollear.
- **Tarjetas y Elementos Reactivos al Scroll y Cursor:** Cards con micro-tilt 3D (`rotateX`, `rotateY`, `scale3d`) y reflejos especulares de luz dorada reactivos al puntero y al avance del scroll.
- **Ambiente de Partículas 3D en Suspensión:** Canvas tridimensional reactivo con polvo de oro / partículas de barbería de lujo que se desplazan y reaccionan a la velocidad del scroll.
- **Transición Espacial en Wizard de Reservas:** Desplazamiento 3D de pasos donde el usuario "viaja" hacia adelante en profundidad al avanzar en la reserva.

---

### 📋 Master Backlog de Tareas Frontend (Épicas F0 a F6)

* **ÉPICA F0: Shell, Layout 3D y Guardias de Acceso**
  - **[x] T-F0.1: Shell Principal (`AppLayoutComponent`): (Completado)**
    - Contenedor con profundidad 3D (`perspective: 1200px`, `transform-style: preserve-3d`), luces ambientales y malla de cuadrícula tridimensional.
    - Navbar flotante glassmorphism (`glass-panel`, `backdrop-blur-xl`, borde dorado translúcido) con logo de la marca y enlaces de navegación reactivos.
    - Badge en tiempo real de Barbería Activa con indicador de estado (verde pulsante para activa, alerta ámbar si no tiene seleccionada).
    - Píldora de perfil con avatar, iniciales, rol del usuario (`CLIENTE`, `ADMIN`, `BARBERO`) y menú desplegable con botón de cierre de sesión.
    - Centro de notificaciones con campana y conteo de no leídas sincronizado con `NotificationService`.
    - Menú lateral responsivo para dispositivos móviles y tablets.
    - Página principal `HomeComponent` con Hero 3D, cards con profundidad Z y accesos directos de agendamiento.
  - **[x] T-F0.2: Motor de scroll 3D e interactividad de profundidad (Completado)**
  - **[x] T-F0.3: Guardias de navegación reactivas (AuthGuard y TenantGuard) (Completado)**

* **ÉPICA F1: Tenant Hub y Gestión de Barberías**
  - **[x] T-F1.1: Pantalla `BarberiasComponent`: Grid de barberías con efecto 3D tilt, badge de activa y selección en un clic (Completado)**
  - **[x] T-F1.2: Modal de Vinculación por Código: Input de 8 caracteres con validación visual inmediata (Completado)**
  - **[x] T-F1.3: Formulario de Creación de Barbería para dueños/responsables (Completado)**

* **ÉPICA F2: Catálogo de Servicios y Combos**
  - **[x] T-F2.1: Grid interactivo 3D de servicios para clientes con precios, duraciones y botón de selección rápida (Completado)**
  - **[x] T-F2.2: Panel administrativo de catálogo (CRUD con cálculo de margen y detección de ciclos) (Completado)**

* **ÉPICA F3: Wizard de Agendamiento Interactivo en 3D**
  - **[x] T-F3.1: `ReservaWizardComponent` multi-paso con transición espacial en profundidad (Completado):**
    - *Paso 1:* Selección de servicios/combos.
    - *Paso 2:* Calendario y barbero.
    - *Paso 3:* Selector de slots de disponibilidad en tiempo real (`/agenda/disponibilidad`).
    - *Paso 4:* Confirmación con snapshot de precio congelado y creación atómica `SERIALIZABLE`.

* **ÉPICA F4: Mis Citas y Agenda de Barberos**
  - **[x] T-F4.1: Timeline 3D de citas del cliente (`MisReservasComponent`) con estados en vivo (Completado)**
  - **[x] T-F4.2: Agenda diaria del barbero (`AgendaBarberoComponent`) con acciones rápidas (Iniciar, Completar, Inasistencia) (Completado)**

* **ÉPICA F5: Cobros y Punto de Venta (POS)**
  - **[x] T-F5.1: Modal de cobro en persona (`CobroModalComponent`) con selección de método de pago y confirmación atómica (Completado)**

* **ÉPICA F6: Ficha de Antecedentes y Notificaciones en Vivo**
  - **[x] T-F6.1: Drawer de ficha técnica del cliente con anonimización inter-barberías (Completado)**
  - **[x] T-F6.2: Centro de notificaciones desplegable en Navbar conectado a la cola asíncrona (Completado)**
