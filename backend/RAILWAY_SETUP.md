# Configuración de Railway para Medusa.js 2.0

Esta guía explica cómo configurar tu proyecto Medusa.js 2.0 en Railway con dos servicios separados: **Server** y **Worker**.

## Arquitectura

- **Server Service**: Maneja todas las peticiones HTTP (API, Admin, Store)
- **Worker Service**: Procesa trabajos en segundo plano, workflows y tareas asíncronas

## Pasos de Configuración en Railway

### 1. Crear el Proyecto Base

1. Conecta tu repositorio a Railway
2. Railway detectará automáticamente el proyecto

### ⚠️ Importante: Build Command vs Start Command

En Railway, hay dos comandos diferentes que debes configurar:

- **Build Command**: Se ejecuta durante la fase de **build/compilación**
  - Debe ser: `pnpm install && pnpm build`
  - Este comando compila TypeScript y crea el directorio `.medusa/server`
  
- **Start Command**: Se ejecuta después del build para **iniciar la aplicación**
  - Para Server: `pnpm start:server`
  - Para Worker: `pnpm start:worker`
  - Este comando inicia la aplicación ya compilada

### 2. Crear el Servicio Server

1. En el dashboard de Railway, crea un **nuevo servicio** desde tu repositorio
2. Nombra el servicio como `medusa-server` o `backend-server`
3. Configura las siguientes variables de entorno en la sección "Variables" del servicio:
   - `MEDUSA_WORKER_MODE=server` ⚠️ **IMPORTANTE**: Esta variable debe estar configurada
   - Todas las demás variables de entorno necesarias (DATABASE_URL, REDIS_URL, JWT_SECRET, etc.)

4. Configura los comandos en la sección "Settings" → "Deploy":
   - **Build Command**: `pnpm install && pnpm build`
     - Este comando compila el proyecto y crea el directorio `.medusa/server`
   - **Start Command**: `pnpm start:server`
     - Este comando inicia la aplicación en modo servidor
   - O si prefieres usar npm: 
     - Build: `npm install && npm run build`
     - Start: `npm run start:server`

5. Configura el puerto:
   - Railway automáticamente asignará un puerto a través de la variable `PORT`
   - Medusa.js 2.0 debería detectar automáticamente esta variable

### 3. Crear el Servicio Worker

1. Crea un **segundo servicio** desde el mismo repositorio
   - En Railway, haz clic en "New Service" → "GitHub Repo" y selecciona el mismo repositorio
2. Nombra el servicio como `medusa-worker` o `backend-worker`
3. Configura las siguientes variables de entorno en la sección "Variables":
   - `MEDUSA_WORKER_MODE=worker` ⚠️ **IMPORTANTE**: Esta variable debe estar configurada
   - Todas las demás variables de entorno necesarias (las mismas que el server: DATABASE_URL, REDIS_URL, JWT_SECRET, etc.)

4. Configura los comandos en la sección "Settings" → "Deploy":
   - **Build Command**: `pnpm install && pnpm build`
     - Este comando compila el proyecto y crea el directorio `.medusa/server`
   - **Start Command**: `pnpm start:worker`
     - Este comando inicia la aplicación en modo worker
   - O si prefieres usar npm:
     - Build: `npm install && npm run build`
     - Start: `npm run start:worker`

5. **Importante**: 
   - Este servicio NO necesita exponer un puerto HTTP
   - **NO necesita Public Networking**: El worker solo se comunica con Redis y la base de datos, no recibe peticiones HTTP externas
   - En Railway, puedes deshabilitar el healthcheck en "Settings" → "Healthcheck" → desactivar "Enable Healthcheck"
   - O configurar un healthcheck simple que siempre retorne éxito
   - En "Settings" → "Networking", puedes dejar el servicio como **privado** (sin dominio público)

### 4. Variables de Entorno Compartidas

Ambos servicios necesitan las mismas variables de entorno, excepto `MEDUSA_WORKER_MODE`:

#### Variables Requeridas
- `DATABASE_URL` - URL de conexión a PostgreSQL
- `REDIS_URL` - URL de conexión a Redis (requerido para workers)
- `JWT_SECRET` - Secreto para firmar tokens JWT
- `COOKIE_SECRET` - Secreto para firmar cookies
- `BACKEND_PUBLIC_URL` - URL pública del backend (solo para server, pero puede estar en ambos)

#### Variables Opcionales
- `ADMIN_CORS` - Orígenes CORS para el admin
- `AUTH_CORS` - Orígenes CORS para autenticación
- `STORE_CORS` - Orígenes CORS para el store
- `SENDGRID_API_KEY` / `RESEND_API_KEY` - Para notificaciones por email
- Variables de configuración de S3, Meilisearch, etc.

### 5. Configuración de Base de Datos y Redis

1. **PostgreSQL**: Crea un servicio PostgreSQL en Railway y conecta ambos servicios (server y worker) a la misma base de datos
2. **Redis**: Crea un servicio Redis en Railway y conecta ambos servicios al mismo Redis (requerido para que los workers funcionen correctamente)

### 6. Configuración de Red

- El servicio **Server**:
  - ✅ **DEBE tener Public Networking habilitado** (necesita un dominio público)
  - ✅ Debe tener un dominio asignado para recibir peticiones HTTP
  - ✅ Necesita exponer un puerto HTTP (Railway lo hace automáticamente)
  
- El servicio **Worker**:
  - ❌ **NO necesita Public Networking** (puede estar en modo privado)
  - ❌ NO necesita dominio público
  - ❌ NO necesita exponer puertos HTTP
  - ✅ Solo necesita conectarse a Redis y PostgreSQL (comunicación interna)

## Verificación

### Verificar que el Server funciona:
1. Accede a la URL pública del servicio server
2. Deberías poder acceder a:
   - `/health` - Health check endpoint
   - `/store` - API del store
   - `/admin` - Dashboard de administración

### Verificar que el Worker funciona:
1. Revisa los logs del servicio worker en Railway
2. Deberías ver mensajes indicando que está en modo worker
3. Los workflows y jobs deberían procesarse en este servicio

## Troubleshooting

### El worker no procesa trabajos
- Verifica que `REDIS_URL` esté configurado correctamente en ambos servicios
- Asegúrate de que ambos servicios estén conectados al mismo Redis
- Verifica que `MEDUSA_WORKER_MODE=worker` esté configurado en el servicio worker

### El server no responde
- Verifica que `MEDUSA_WORKER_MODE=server` esté configurado
- Revisa que el puerto esté correctamente configurado
- Verifica los logs para errores de conexión a la base de datos

### Ambos servicios fallan al iniciar
- Verifica que todas las variables de entorno requeridas estén configuradas
- Asegúrate de que la base de datos y Redis estén accesibles
- Revisa los logs de build para errores de compilación

## Notas Importantes

1. **Redis es requerido**: Para que los workers funcionen correctamente, necesitas Redis configurado. Sin Redis, los workers no podrán procesar trabajos.

2. **Misma base de datos**: Ambos servicios deben usar la misma base de datos PostgreSQL.

3. **Mismo Redis**: Ambos servicios deben usar el mismo Redis para el Event Bus y Workflow Engine.

4. **Escalabilidad**: Puedes escalar el servicio worker independientemente del server si necesitas más capacidad de procesamiento.

5. **Costos**: Tener dos servicios separados puede aumentar los costos, pero mejora la escalabilidad y separación de responsabilidades.

## Scripts Disponibles

- `pnpm start:server` - Inicia en modo servidor
- `pnpm start:worker` - Inicia en modo worker
- `pnpm start` - Inicia en modo compartido (por defecto, no recomendado para producción)

