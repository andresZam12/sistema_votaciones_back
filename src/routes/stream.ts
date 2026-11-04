import { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { redis } from '../redis/client.js';
import { topicManager, SSEClient } from '../fanout/topics.js';

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stream', async (req, reply) => {
    const query = req.query as { topic?: string };
    const topic = query.topic || 'dep';

    // Validar formato del tópico
    if (topic !== 'dep' && !topic.startsWith('mun:') && !topic.startsWith('puesto:')) {
      return reply.status(400).send({
        error: 'Topico invalido',
        permitidos: ['dep', 'mun:{id}', 'puesto:{id}']
      });
    }

    const lastEventId = (req.headers['last-event-id'] as string) || undefined;

    // Configuración nativa de SSE (HTTP/1.1 streaming)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.flushHeaders();

    const clientId = crypto.randomUUID();
    const client: SSEClient = {
      id: clientId,
      topic,
      res: reply.raw,
      lagged: false,
      lastEventId
    };

    // Parsear tipo y entidadId para snapshot.lua
    let tipo = 'dep';
    let entidadId = '';
    if (topic.startsWith('mun:')) {
      tipo = 'mun';
      entidadId = topic.split(':')[1];
    } else if (topic.startsWith('puesto:')) {
      tipo = 'puesto';
      entidadId = topic.split(':')[1];
    }

    // RF-6: Reconexión con recuperación de lo perdido
    let envioExitoso = false;

    if (lastEventId) {
      try {
        // Consultar eventos desde el último recibido: XRANGE ev:actas (lastId + COUNT 501
        // En Redis Streams, '(' indica rango exclusivo
        const range = await redis.xrange('ev:actas', `(${lastEventId}`, '+', 'COUNT', 501);

        if (range && range.length > 0 && range.length <= 500) {
          // Filtrar y acumular deltas solo para el tópico solicitado
          const deltasCatchup: Record<string, number> = {};
          let mesasNuevas = 0;
          let latestId = lastEventId;
          let motivo: 'nueva' | 'correccion' = 'nueva';

          for (const [id, fields] of range) {
            latestId = id;
            const data: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
              data[fields[i]] = fields[i + 1];
            }

            // Verificar si el evento pertenece al tópico
            const coincide =
              topic === 'dep' ||
              (tipo === 'mun' && data.mun === entidadId) ||
              (tipo === 'puesto' && data.puesto === entidadId);

            if (coincide) {
              if (data.kind === 'correccion') motivo = 'correccion';
              if (data.kind === 'nueva') mesasNuevas++;

              try {
                const itemDeltas = JSON.parse(data.delta || '{}');
                for (const [cand, diff] of Object.entries(itemDeltas)) {
                  deltasCatchup[cand] = (deltasCatchup[cand] || 0) + (diff as number);
                }
              } catch {}
            }
          }

          const catchupPayload = JSON.stringify({
            tipo: 'delta',
            topic,
            streamId: latestId,
            mesasNuevas,
            deltas: deltasCatchup,
            motivo,
            catchup: true
          });

          reply.raw.write(`id: ${latestId}\nevent: delta\ndata: ${catchupPayload}\n\n`);
          client.lastEventId = latestId;
          envioExitoso = true;
        }
      } catch (err) {
        // Si falla XRANGE (cursor no válido o recortado), cae al snapshot
      }
    }

    // Si no hubo Last-Event-ID o el desfase superó los 500 eventos / recorte
    if (!envioExitoso) {
      try {
        const snapshotJson = await redis.getSnapshot(tipo, entidadId);
        const parsed = JSON.parse(snapshotJson);
        reply.raw.write(`id: ${parsed.streamId}\nevent: snapshot\ndata: ${snapshotJson}\n\n`);
        client.lastEventId = parsed.streamId;
      } catch (err) {
        reply.raw.write(
          `event: degraded\ndata: {"status":"degraded","motivo":"snapshot_unavailable"}\n\n`
        );
      }
    }

    // Suscribir al topic manager
    topicManager.subscribe(topic, client);

    // Limpieza al cerrar la conexión
    req.raw.on('close', () => {
      topicManager.unsubscribe(topic, client);
    });
  });
};
