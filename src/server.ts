import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { whoamiRoutes } from './routes/whoami.js';
import { healthRoutes } from './routes/health.js';

export function buildApp() {
  const app = Fastify({
    logger: false
  });

  // Habilitar CORS para permitir llamadas desde el front del compañero
  app.register(cors, {
    origin: true
  });

  // Registrar rutas base
  app.register(whoamiRoutes);
  app.register(healthRoutes);

  return app;
}

export async function startServer() {
  const app = buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[${config.instanceId}] Servidor escuchando en http://${config.host}:${config.port}`);
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
