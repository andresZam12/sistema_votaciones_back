import { topicManager, SSEClient } from './topics.js';
import { config } from '../config.js';

interface TopicDeltaBuffer {
  streamId: string;
  deltas: Record<string, number>;
  mesasNuevas: number;
  motivo: 'nueva' | 'correccion';
}

export class FanoutBatcher {
  private buffers: Map<string, TopicDeltaBuffer> = new Map();
  private timer: NodeJS.Timeout | null = null;
  public totalMessagesSent = 0;
  public lastPublishDelayMs = 0;

  constructor() {
    this.startWindowTimer();
  }

  // Agrega un evento recibido del Stream de Redis al buffer del tópico correspondiente
  accumulateEvent(
    streamId: string,
    topic: string,
    deltas: Record<string, number>,
    kind: 'nueva' | 'correccion',
    tsIngest: number
  ): void {
    let buf = this.buffers.get(topic);
    if (!buf) {
      buf = {
        streamId,
        deltas: {},
        mesasNuevas: 0,
        motivo: kind
      };
      this.buffers.set(topic, buf);
    }

    buf.streamId = streamId;
    if (kind === 'nueva') {
      buf.mesasNuevas += 1;
    } else {
      buf.motivo = 'correccion'; // si hay al menos una corrección, lo indicamos
    }

    for (const [cand, diff] of Object.entries(deltas)) {
      buf.deltas[cand] = (buf.deltas[cand] || 0) + diff;
    }

    // Medición del retraso recepción -> publicación
    this.lastPublishDelayMs = Math.max(0, Date.now() - tsIngest);
  }

  private startWindowTimer(): void {
    this.timer = setInterval(() => {
      this.flush().catch((err) => console.error('[BATCHER] Error en flush:', err));
    }, config.fanoutWindowMs);
  }

  // Emite los deltas agregados por ventana de tiempo en lotes con setImmediate
  public async flush(): Promise<void> {
    if (this.buffers.size === 0) return;

    // Copiar y limpiar el buffer para la siguiente ventana
    const currentBuffers = new Map(this.buffers);
    this.buffers.clear();

    for (const [topic, buf] of currentBuffers.entries()) {
      const subscribers = topicManager.getSubscribers(topic);
      if (!subscribers || subscribers.size === 0) continue;

      // Serializar UNA SOLA VEZ para todos los suscriptores del tópico
      const payload = JSON.stringify({
        tipo: 'delta',
        topic,
        streamId: buf.streamId,
        mesasNuevas: buf.mesasNuevas,
        deltas: buf.deltas,
        motivo: buf.motivo
      });

      const sseMessage = `id: ${buf.streamId}\nevent: delta\ndata: ${payload}\n\n`;

      // Reparto en lotes cediendo al Event Loop (RF-4)
      const clientsList = Array.from(subscribers);
      for (let i = 0; i < clientsList.length; i += config.fanoutBatch) {
        const batch = clientsList.slice(i, i + config.fanoutBatch);

        for (const client of batch) {
          this.sendToClient(client, sseMessage, buf.streamId);
        }

        // Ceder control al Event Loop entre lotes
        if (i + config.fanoutBatch < clientsList.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
  }

  private sendToClient(client: SSEClient, message: string, streamId: string): void {
    if (client.res.writableEnded) return;

    // RF-9: Contrapresión - vigilar buffer de salida (256 KB)
    if (client.res.writableLength > config.maxBufferedBytes) {
      if (!client.lagged) {
        client.lagged = true;
        client.laggedSince = Date.now();
      } else if (client.laggedSince && Date.now() - client.laggedSince > 10000) {
        // Desconectar cliente rezagado tras 10 segundos para que reconecte limpiamente
        client.res.end();
        topicManager.unsubscribe(client.topic, client);
        return;
      }
      return; // Saltamos el envío del delta detallado mientras esté saturado
    }

    client.lagged = false;
    client.laggedSince = undefined;
    client.lastEventId = streamId;

    client.res.write(message);
    this.totalMessagesSent++;
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const fanoutBatcher = new FanoutBatcher();
