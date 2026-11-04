import { redis } from '../redis/client.js';
import { config } from '../config.js';
import { eventLoopMonitor } from './eventLoop.js';
import { topicManager } from '../fanout/topics.js';
import { fanoutBatcher } from '../fanout/batcher.js';

export interface InstanceMetrics {
  instancia: string;
  ts: number;
  conexionesSse: number;
  conexionesWs: number;
  conexionesTotales: number;
  mensajesPorSegundo: number;
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  rssMb: number;
  heapUsedMb: number;
  memoriaPorConexionKb: number;
  retrasoRecepcionPublicacionMs: number;
}

export class MetricsPublisher {
  private timer: NodeJS.Timeout | null = null;
  private lastSentMessages = 0;
  private activeWsConnections = 0;

  setActiveWsConnections(count: number): void {
    this.activeWsConnections = count;
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      try {
        await this.publishLocalMetrics();
      } catch {
        // En caso de que Redis esté temporalmente degradado
      }
    }, 1000);
  }

  async publishLocalMetrics(): Promise<void> {
    const mem = process.memoryUsage();
    const elMetrics = eventLoopMonitor.getMetrics();
    const sseCount = topicManager.getTotalConnections();
    const wsCount = this.activeWsConnections;
    const totalConn = sseCount + wsCount;

    const currentSent = fanoutBatcher.totalMessagesSent;
    const msgSec = Math.max(0, currentSent - this.lastSentMessages);
    this.lastSentMessages = currentSent;

    const rssMb = Number((mem.rss / (1024 * 1024)).toFixed(2));
    const heapUsedMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
    const memPerConnKb = totalConn > 0 ? Number(((mem.rss / totalConn) / 1024).toFixed(2)) : 0;

    const metricsData: InstanceMetrics = {
      instancia: config.instanceId,
      ts: Date.now(),
      conexionesSse: sseCount,
      conexionesWs: wsCount,
      conexionesTotales: totalConn,
      mensajesPorSegundo: msgSec,
      eventLoopP50Ms: elMetrics.p50,
      eventLoopP99Ms: elMetrics.p99,
      eventLoopMaxMs: elMetrics.max,
      rssMb,
      heapUsedMb,
      memoriaPorConexionKb: memPerConnKb,
      retrasoRecepcionPublicacionMs: fanoutBatcher.lastPublishDelayMs
    };

    const key = `ops:inst:${config.instanceId}`;
    const pipeline = redis.pipeline();
    pipeline.hset(key, {
      data: JSON.stringify(metricsData)
    });
    pipeline.expire(key, 5); // TTL de 5s para auto-limpieza si la réplica muere
    await pipeline.exec();
  }

  // Agrega las métricas de todas las réplicas vivas
  async aggregateOpsData(): Promise<{
    global: {
      totalInstancias: number;
      conexionesTotales: number;
      conexionesSse: number;
      conexionesWs: number;
      mensajesPorSegundoTotal: number;
      eventLoopP99Promedio: number;
      rssTotalMb: number;
      retrasoMaximoMs: number;
    };
    instancias: InstanceMetrics[];
  }> {
    const keys = await redis.keys('ops:inst:*');
    const instancias: InstanceMetrics[] = [];

    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      for (const k of keys) {
        pipeline.hget(k, 'data');
      }
      const results = await pipeline.exec();
      if (results) {
        for (const [err, val] of results) {
          if (!err && val && typeof val === 'string') {
            try {
              instancias.push(JSON.parse(val));
            } catch {}
          }
        }
      }
    }

    // Calcular agregados globales
    const totalInstancias = instancias.length;
    let conexionesTotales = 0;
    let conexionesSse = 0;
    let conexionesWs = 0;
    let mensajesPorSegundoTotal = 0;
    let sumaP99 = 0;
    let rssTotalMb = 0;
    let retrasoMaximoMs = 0;

    for (const inst of instancias) {
      conexionesTotales += inst.conexionesTotales;
      conexionesSse += inst.conexionesSse;
      conexionesWs += inst.conexionesWs;
      mensajesPorSegundoTotal += inst.mensajesPorSegundo;
      sumaP99 += inst.eventLoopP99Ms;
      rssTotalMb += inst.rssMb;
      if (inst.retrasoRecepcionPublicacionMs > retrasoMaximoMs) {
        retrasoMaximoMs = inst.retrasoRecepcionPublicacionMs;
      }
    }

    const eventLoopP99Promedio = totalInstancias > 0 ? Number((sumaP99 / totalInstancias).toFixed(2)) : 0;

    return {
      global: {
        totalInstancias,
        conexionesTotales,
        conexionesSse,
        conexionesWs,
        mensajesPorSegundoTotal,
        eventLoopP99Promedio,
        rssTotalMb: Number(rssTotalMb.toFixed(2)),
        retrasoMaximoMs
      },
      instancias
    };
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const metricsPublisher = new MetricsPublisher();
