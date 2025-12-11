### local setup
Video instructions: https://youtu.be/PPxenu7IjGM

- `cd /backend`
- `pnpm install` or `npm i`
- Rename `.env.template` ->  `.env`
- To connect to your online database from your local machine, copy the `DATABASE_URL` value auto-generated on Railway and add it to your `.env` file.
  - If connecting to a new database, for example a local one, run `pnpm ib` or `npm run ib` to seed the database.
- `pnpm dev` or `npm run dev`

### requirements
- **postgres database** (Automatic setup when using the Railway template)
- **redis** (Automatic setup when using the Railway template) - fallback to simulated redis.
- **MinIO storage** (Automatic setup when using the Railway template) - fallback to local storage.
- **Meilisearch** (Automatic setup when using the Railway template)

### commands

`cd backend/`
`npm run ib` or `pnpm ib` will initialize the backend by running migrations and seed the database with required system data.
`npm run dev` or `pnpm dev` will start the backend (and admin dashboard frontend on `localhost:9000/app`) in development mode.
`pnpm build && pnpm start` will compile the project and run from compiled source. This can be useful for reproducing issues on your cloud instance.

### Railway deployment (Server + Worker)

Este proyecto está configurado para ejecutarse en Railway con dos servicios separados:

- **Server Service**: Maneja todas las peticiones HTTP (API, Admin, Store)
- **Worker Service**: Procesa trabajos en segundo plano, workflows y tareas asíncronas

Para configurar los servicios en Railway, consulta el archivo **[RAILWAY_SETUP.md](./RAILWAY_SETUP.md)** que contiene instrucciones detalladas paso a paso.

**Scripts disponibles:**
- `pnpm start:server` - Inicia en modo servidor (para el servicio Server en Railway)
- `pnpm start:worker` - Inicia en modo worker (para el servicio Worker en Railway)
- `pnpm start` - Inicia en modo compartido (por defecto, no recomendado para producción)