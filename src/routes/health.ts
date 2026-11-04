import { FastifyPluginAsync } from 'fastify';
import { checkRedisHealth } from '../redis/client.js';
import { config } from '../config.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    const isRedisOk = await checkRedisHealth();

    if (!isRedisOk) {
      return reply.status(503).header('Retry-After', '5').send({
        status: 'degraded',
        redis: 'down',
        instancia: config.instanceId
      });
    }

    return reply.status(200).send({
      status: 'ok',
      redis: 'ok',
      instancia: config.instanceId
    });
  });
};
