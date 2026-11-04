import { Redis } from 'ioredis';
import { config } from '../config.js';
import { fanoutBatcher } from '../fanout/batcher.js';

export class StreamReader {
  private client: Redis | null = null;
  private isRunning = false;
  private lastId = '$';

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.client = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });

    this.client.on('error', () => {});

    try {
      await this.client.connect();
      console.log(`[STREAM_READER] Conectado a Redis Stream ev:actas`);
      this.pollLoop();
    } catch (err) {
      console.warn(`[STREAM_READER] No se pudo conectar inmediatamente a Redis Stream:`, (err as Error).message);
      // Reintentar en 3 segundos
      setTimeout(() => {
        if (this.isRunning) this.start();
      }, 3000);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning && this.client) {
      try {
        // XREAD BLOCK 2000 STREAMS ev:actas lastId
        const response = await this.client.xread(
          'BLOCK',
          2000,
          'STREAMS',
          'ev:actas',
          this.lastId
        );

        if (response && response.length > 0) {
          const [_streamKey, messages] = response[0];
          for (const [id, fields] of messages) {
            this.lastId = id;
            this.processMessage(id, fields);
          }
        }
      } catch (err) {
        if (!this.isRunning) break;
        // Esperar brevemente antes de reintentar si hubo desconexión
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private processMessage(streamId: string, fields: string[]): void {
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    try {
      const deltas = JSON.parse(data.delta || '{}');
      const kind = (data.kind === 'correccion' ? 'correccion' : 'nueva') as 'nueva' | 'correccion';
      const tsIngest = Number(data.ts_ingest || Date.now());

      // Difundir a nivel departamento
      fanoutBatcher.accumulateEvent(streamId, 'dep', deltas, kind, tsIngest);

      // Difundir a nivel municipio
      if (data.mun) {
        fanoutBatcher.accumulateEvent(streamId, `mun:${data.mun}`, deltas, kind, tsIngest);
      }

      // Difundir a nivel puesto
      if (data.puesto) {
        fanoutBatcher.accumulateEvent(streamId, `puesto:${data.puesto}`, deltas, kind, tsIngest);
      }
    } catch (err) {
      console.error('[STREAM_READER] Error procesando evento de stream:', err);
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
    }
  }
}

export const streamReader = new StreamReader();

