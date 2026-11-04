import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { config } from '../config.js';
import { redis } from '../redis/client.js';
import { presenceManager } from './presencia.js';
import { metricsPublisher } from '../metrics/publisher.js';

interface AuditorSession {
  auditorId: string;
  ws: WebSocket;
  currentCaseId: string | null;
  currentToken: string | null;
  lastActivityTs: number;
}

export class AuditorWsServer {
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, AuditorSession> = new Map();
  private broadcastTimer: NodeJS.Timeout | null = null;

  init(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const parsedUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);

      if (parsedUrl.pathname === '/auditores') {
        const key = parsedUrl.searchParams.get('key');
        const auditorId = parsedUrl.searchParams.get('id') || `aud-${crypto.randomBytes(3).toString('hex')}`;

        // Validación de autenticación de auditor
        if (!key || !config.auditorKeys.includes(key)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request, auditorId);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, auditorId: string) => {
      this.handleConnection(ws, auditorId);
    });

    // Broadcast periódico de estado de cola y presencia (cada 3s)
    this.broadcastTimer = setInterval(() => {
      this.broadcastState().catch(() => {});
    }, 3000);
  }

  private handleConnection(ws: WebSocket, auditorId: string): void {
    const session: AuditorSession = {
      auditorId,
      ws,
      currentCaseId: null,
      currentToken: null,
      lastActivityTs: Date.now()
    };

    this.sessions.set(auditorId, session);
    metricsPublisher.setActiveWsConnections(this.sessions.size);

    presenceManager.updatePresence(auditorId, null, true).catch(() => {});

    // Bienvenida
    this.sendJson(ws, {
      evento: 'conectado',
      auditorId,
      instancia: config.instanceId
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await this.handleMessage(session, msg);
      } catch (err) {
        this.sendJson(ws, { error: 'Mensaje JSON invalido' });
      }
    });

    ws.on('close', async () => {
      // Si tenía un caso asignado, se deja vencer el lock o se libera
      this.sessions.delete(auditorId);
      metricsPublisher.setActiveWsConnections(this.sessions.size);
      await presenceManager.removePresence(auditorId);
    });
  }

  private async handleMessage(session: AuditorSession, msg: any): Promise<void> {
    const { ws, auditorId } = session;

    if (msg.accion === 'tomar') {
      const token = crypto.randomUUID();
      const res = await redis.takeCase(auditorId, token, 30000);

      const status = res[0];
      if (status === 'OK') {
        const actaId = res[1]!;
        const caseDataStr = res[3] || '{}';
        session.currentCaseId = actaId;
        session.currentToken = token;
        session.lastActivityTs = Date.now();

        await presenceManager.updatePresence(auditorId, actaId, true);

        this.sendJson(ws, {
          evento: 'caso_asignado',
          acta: actaId,
          token,
          caso: JSON.parse(caseDataStr)
        });
      } else if (status === 'EMPTY') {
        this.sendJson(ws, { evento: 'cola_vacia' });
      } else if (status === 'LOCKED_BY_OTHER') {
        this.sendJson(ws, { evento: 'caso_tomado_por_otro', acta: res[1] });
      }
    } else if (msg.accion === 'latido') {
      const actividadReal = Boolean(msg.actividad);
      const ahora = Date.now();

      if (actividadReal) {
        session.lastActivityTs = ahora;
      }

      // Regla de negocio de latido: solo renueva el lock si hubo actividad real en los últimos 2 minutos
      const inactividadMs = ahora - session.lastActivityTs;
      const sigueTrabajando = inactividadMs < 120000;

      let renovado = false;
      if (session.currentCaseId && session.currentToken && sigueTrabajando) {
        const owner = `${auditorId}:${session.currentToken}`;
        const resRenew = await redis.renewLock(session.currentCaseId, owner, 30000);
        renovado = resRenew === 1;
      }

      await presenceManager.updatePresence(auditorId, session.currentCaseId, sigueTrabajando);

      this.sendJson(ws, {
        evento: 'latido_ack',
        renovado,
        inactividadSegundos: Math.floor(inactividadMs / 1000)
      });
    } else if (msg.accion === 'liberar') {
      if (session.currentCaseId && session.currentToken) {
        const owner = `${auditorId}:${session.currentToken}`;
        const resRelease = await redis.releaseLock(session.currentCaseId, owner, 'liberar');

        session.currentCaseId = null;
        session.currentToken = null;
        await presenceManager.updatePresence(auditorId, null, true);

        this.sendJson(ws, {
          evento: 'caso_liberado',
          exito: resRelease === 1
        });
      }
    } else if (msg.accion === 'cerrar_caso') {
      if (session.currentCaseId && session.currentToken) {
        const owner = `${auditorId}:${session.currentToken}`;
        const resClose = await redis.releaseLock(session.currentCaseId, owner, 'cerrar');

        session.currentCaseId = null;
        session.currentToken = null;
        await presenceManager.updatePresence(auditorId, null, true);

        this.sendJson(ws, {
          evento: 'caso_cerrado',
          resolucion: msg.resolucion || 'aprobada',
          exito: resClose === 1
        });
      }
    }
  }

  private async broadcastState(): Promise<void> {
    if (this.sessions.size === 0) return;

    try {
      const queueCount = await redis.zcard('verif:queue');
      const auditores = await presenceManager.getActiveAuditors();

      const stateMsg = JSON.stringify({
        evento: 'estado_global',
        pendientesCola: queueCount,
        auditores
      });

      for (const session of this.sessions.values()) {
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(stateMsg);
        }
      }
    } catch {}
  }

  private sendJson(ws: WebSocket, payload: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  stop(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

export const auditorWsServer = new AuditorWsServer();

