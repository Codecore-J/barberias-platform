# syntax=docker/dockerfile:1
#
# API NestJS · contenerización multi-stage (Paso 17).
#
# El contexto de build es la RAÍZ del monorepo (no backend-barberias/): el
# repositorio usa npm workspaces, así que `npm ci` necesita el package-lock.json
# y los manifestos de ambos paquetes. Ver docker-compose.yml.
#
#   docker build -f backend-barberias/Dockerfile .
#
# Etapa 1 · construcción ------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Toolchain solo para compilar módulos nativos si el paquete no trae binario
# precompilado para musl (bcrypt). `openssl` (CLI) es obligatorio: sin él
# Prisma no detecta la versión de libssl y elige el engine equivocado
# («failed to detect the libssl/openssl version»). Se descarta con la imagen
# intermedia salvo openssl.
RUN apk add --no-cache python3 make g++ openssl

# Manifestos primero: cualquier cambio en el código no invalida la capa de
# dependencias.
COPY package.json package-lock.json ./
COPY backend-barberias/package.json ./backend-barberias/package.json
COPY frontend-barberias/package.json ./frontend-barberias/package.json
RUN npm ci

# Código y compilación: cliente de Prisma + `nest build` (tsconfig.build.json
# fija rootDir en src/, así que el salida es dist/main.js).
COPY backend-barberias ./backend-barberias
WORKDIR /app/backend-barberias
RUN npx prisma generate && npm run build

# Etapa 2 · producción -------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Solo dependencias de producción (npm ci --omit=dev). El toolchain virtual se
# elimina en la misma capa: el binario compilado ya vive en node_modules.
# `openssl` se QUEDA (fuera del grupo virtual): el engine de consulta de Prisma
# generado para openssl-3.0.x necesita la librería en tiempo de ejecución.
COPY package.json package-lock.json ./
COPY backend-barberias/package.json ./backend-barberias/package.json
COPY frontend-barberias/package.json ./frontend-barberias/package.json
RUN apk add --no-cache openssl \
 && apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm ci --omit=dev \
 && apk del .build-deps \
 && npm cache clean --force

WORKDIR /app/backend-barberias

# dist compilado + esquema/migraciones de Prisma.
COPY --from=builder /app/backend-barberias/dist ./dist
COPY --from=builder /app/backend-barberias/prisma ./prisma
# Cliente de Prisma YA generado (incluye el engine de consulta): con
# --omit=dev no está el CLI `prisma` para regenerarlo en esta etapa. RUTA
# ABSOLUTA: el WORKDIR es /app/backend-barberias y la resolución relativa lo
# dejaría fuera del node_modules donde Node resuelve el cliente.
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

EXPOSE 3000

CMD ["node", "dist/main"]