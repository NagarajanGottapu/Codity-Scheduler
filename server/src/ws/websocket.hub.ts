import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'node:http';

export interface WebSocketMessage {
  type:
    | 'job:created'
    | 'job:status_changed'
    | 'job:log'
    | 'worker:heartbeat'
    | 'worker:status_changed'
    | 'queue:updated'
    | 'dlq:alert'
    | 'workflow:updated'
    | 'system:metrics';
  payload: any;
  timestamp: string;
}

export class WebSocketHub {
  private static instance: WebSocketHub;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  private constructor() {}

  public static getInstance(): WebSocketHub {
    if (!WebSocketHub.instance) {
      WebSocketHub.instance = new WebSocketHub();
    }
    return WebSocketHub.instance;
  }

  public initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // Send initial welcome & connected ping
      this.sendToClient(ws, {
        type: 'system:metrics',
        payload: { message: 'Connected to Codity Distributed Scheduler Real-time Stream', activeClients: this.clients.size },
        timestamp: new Date().toISOString()
      });

      ws.on('message', (data: string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch (e) {
          // Ignore invalid incoming json
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  public broadcast(type: WebSocketMessage['type'], payload: any): void {
    const message: WebSocketMessage = {
      type,
      payload,
      timestamp: new Date().toISOString()
    };

    const serialized = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(serialized);
        } catch (e) {
          this.clients.delete(client);
        }
      }
    }
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }
}

export const wsHub = WebSocketHub.getInstance();
