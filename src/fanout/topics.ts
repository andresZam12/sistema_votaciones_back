import { ServerResponse } from 'node:http';
import { config } from '../config.js';

export interface SSEClient {
  id: string;
  topic: string;
  res: ServerResponse;
  lagged: boolean;
  laggedSince?: number;
  lastEventId?: string;
}

export class TopicManager {
  // Mapa de tópico -> Set de conexiones (RF-5: Alta/Baja O(1), recorrido proporcional a los suscriptores)
  private subscriptions: Map<string, Set<SSEClient>> = new Map();
  private totalClients = 0;

  subscribe(topic: string, client: SSEClient): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(client);
    this.totalClients++;
  }

  unsubscribe(topic: string, client: SSEClient): void {
    const clients = this.subscriptions.get(topic);
    if (clients) {
      if (clients.delete(client)) {
        this.totalClients--;
      }
      if (clients.size === 0) {
        this.subscriptions.delete(topic);
      }
    }
  }

  getSubscribers(topic: string): Set<SSEClient> | undefined {
    return this.subscriptions.get(topic);
  }

  getTotalConnections(): number {
    return this.totalClients;
  }

  getConnectionsByTopic(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [topic, set] of this.subscriptions.entries()) {
      result[topic] = set.size;
    }
    return result;
  }

  // Notificar a todos los clientes de una degradación general (RF-10)
  broadcastDegraded(): void {
    const message = `event: degraded\ndata: {"status":"degraded","motivo":"redis_unreachable"}\n\n`;
    for (const clients of this.subscriptions.values()) {
      for (const client of clients) {
        if (!client.res.writableEnded) {
          client.res.write(message);
        }
      }
    }
  }
}

export const topicManager = new TopicManager();
