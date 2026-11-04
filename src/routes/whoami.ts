import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

export const whoamiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/whoami', async (_req, reply) => {
    return reply.status(200).send({
      instancia: config.instanceId
    });
  });
};

