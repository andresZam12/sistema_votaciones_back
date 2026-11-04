import { FastifyPluginAsync } from 'fastify';
import { ActaInputSchema, esActaDudosa } from '../types/acta.js';
import { redis } from '../redis/client.js';
import { config } from '../config.js';

export const actasRoutes: FastifyPluginAsync = async (app) => {
  app.post('/actas', async (req, reply) => {
    // 1. Verificación de credencial de jurado
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || (typeof apiKey === 'string' && !config.juradoKeys.includes(apiKey))) {
      return reply.status(401).send({
        error: 'No autorizado',
        mensaje: 'Cabecera x-api-key inválida o ausente'
      });
    }

    // 2. Validación de esquema con Zod
    const parseResult = ActaInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(422).send({
        error: 'Validacion fallida',
        detalle: parseResult.error.errors
      });
    }

    const acta = parseResult.data;
    const dudosa = esActaDudosa(acta);

    try {
      // 3. Rate limiting (300 actas/min por credencial)
      const currentMinute = Math.floor(Date.now() / 60000);
      const rlKey = `rl:${apiKey}:${currentMinute}`;
      const [allowed] = await redis.rateLimit(rlKey, 60, 300);

      if (allowed === 0) {
        return reply.status(429).header('Retry-After', '60').send({
          error: 'Limite de tasa excedido',
          retryAfter: 60
        });
      }

      // 4. Protección de idempotencia por clave 'idem' (24h TTL)
      // SET idem:{idem} 1 NX EX 86400
      const idemKey = `idem:${acta.idem}`;
      const idemSet = await redis.set(idemKey, '1', 'EX', 86400, 'NX');

      if (!idemSet) {
        // La clave de idempotencia ya existía: reintento exacto del jurado
        const vGuardada = await redis.hget(`acta:${acta.acta}`, 'version');
        return reply.status(200).send({
          estado: 'ya_registrada',
          acta: acta.acta,
          version: vGuardada ? Number(vGuardada) : acta.version,
          motivo: 'idempotencia_idem'
        });
      }

      // 5. Ingestión atómica vía applyActa.lua
      const tsIngest = Date.now().toString();
      const [status, resStreamOrVersion, resVersion, kind] = await redis.applyActa(
        acta.acta,
        acta.version,
        acta.mesa,
        acta.puesto,
        acta.municipio,
        JSON.stringify(acta.votos),
        acta.sufragantes,
        dudosa ? 1 : 0,
        acta.jurado,
        acta.hash_foto,
        acta.ts_cierre,
        tsIngest,
        config.instanceId
      );

      if (status === 'STALE') {
        return reply.status(200).send({
          estado: 'ya_registrada',
          acta: acta.acta,
          version: Number(resStreamOrVersion),
          motivo: 'version_obsoleta_o_igual'
        });
      }

      // Registrada exitosamente (nueva o corrección)
      return reply.status(201).send({
        estado: 'registrada',
        acta: acta.acta,
        version: acta.version,
        dudosa,
        kind,
        streamId: resStreamOrVersion
      });
    } catch (err) {
      // RF-10: Degradación explícita ante fallo de Redis (jamás 200 silencioso)
      req.log.error(err);
      return reply.status(503).header('Retry-After', '5').send({
        error: 'Servicio degradado temporalmente',
        retryAfter: 5,
        instancia: config.instanceId
      });
    }
  });
};
