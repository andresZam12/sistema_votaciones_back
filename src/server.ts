import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { whoamiRoutes } from './routes/whoami.js';
import { healthRoutes } from './routes/health.js';
import { actasRoutes } from './routes/actas.js';
import { streamRoutes } from './routes/stream.js';
import { registerLuaScripts } from './redis/scripts.js';
import { streamReader } from './redis/streamReader.js';

export function buildApp() {
  const app = Fastify({
    logger: false
  });

  // Habilitar CORS para permitir llamadas desde el front del compañero
  app.register(cors, {
    origin: true
  });

  // Registrar comandos Lua en cliente Redis
  registerLuaScripts();

  // Registrar rutas
  app.register(whoamiRoutes);
  app.register(healthRoutes);
  app.register(actasRoutes);
  app.register(streamRoutes);

  return app;
}

export async function startServer() {
  const app = buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[${config.instanceId}] Servidor escuchando en http://${config.host}:${config.port}`);

    // Iniciar el lector continuo de Redis Stream en segundo plano
    streamReader.start().catch((err) => {
      console.warn(`[${config.instanceId}] StreamReader no pudo iniciar:`, err.message);
    });

    return app;
  } catch (err) {
    console.error(`[${config.instanceId}] Error al iniciar el servidor:`, err);
    process.exit(1);
  }
}

// Iniciar automáticamente si se ejecuta directo
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer();
}
