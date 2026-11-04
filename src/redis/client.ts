import { Redis } from 'ioredis';
import { config } from '../config.js';

// Cliente Redis estándar para comandos y escrituras
export const redis = new Redis(config.redisUrl, {
  enableOfflineQueue: false, // RF-10: no encolar peticiones en memoria si Redis cae
  maxRetriesPerRequest: 1,
  lazyConnect: true
});

// Función auxiliar para comprobar estado de conexión
export async function checkRedisHealth(): Promise<boolean> {
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
