# Entornos de la Plataforma

Este documento describe la estrategia de entornos de la Plataforma de Gestión de Barberías, según lo establecido en las decisiones de diseño (D11).

## Tabla de Entornos

| Entorno | Base de Datos (Neon) | Servicio (Render/Vercel) | Variables Clave (solo nombres) |
|---|---|---|---|
| **dev** | Rama `dev` de Neon | Localhost (máquina del desarrollador) | `APP_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `REDIS_URL`, `NODE_ENV`, `UV_THREADPOOL_SIZE`, `DEBUG_PRISMA` |
| **staging** | Rama principal (actual) en Neon | Render (Ohio) y Vercel | `APP_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `REDIS_URL`, `NODE_ENV`, `UV_THREADPOOL_SIZE`, `DEBUG_PRISMA` |
| **production** | Base de datos limpia a crear (L-01) | Producción oficial | `APP_ENV`, `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `REDIS_URL`, `NODE_ENV`, `UV_THREADPOOL_SIZE`, `CONFIRM_CREATE_ADMIN` |

## Reglas Críticas

1. **Tests Destructivos SOLO en `dev`**: Cualquier prueba automatizada que borre datos, limpie tablas o altere el estado de manera destructiva debe verificar rigurosamente que la variable `APP_ENV` sea igual a `dev` antes de ejecutarse. Si la prueba detecta que el entorno es distinto, abortará inmediatamente con un error claro.
2. **Entorno en la Aplicación**: La aplicación requiere obligatoriamente la variable `APP_ENV` (`dev`, `staging`, `production`) y abortará el inicio si no está presente o tiene un valor no permitido.
