type Listener = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<Listener>> = new Map();
  private isConnected = false;
  private reconnectTimer: any = null;
  private statusListeners: Set<(connected: boolean) => void> = new Set();

  constructor() {
    this.connect();
  }

  private getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    // If running on Vite dev port 5173, point directly to backend port 4000
    if (window.location.port === '5173') {
      return `${protocol}//${hostname}:4000/ws`;
    }
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.getWsUrl());

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyStatus(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.emit(message.type, message.payload, message.timestamp);
        } catch (e) {
          // ignore
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.notifyStatus(false);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    }
  }

  public on(event: string, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  public onStatusChange(callback: (connected: boolean) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.isConnected);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      listener(connected);
    }
  }

  private emit(event: string, payload: any, timestamp?: string): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const listener of list) {
        listener({ payload, timestamp });
      }
    }

    // Also emit catch-all '*'
    const all = this.listeners.get('*');
    if (all) {
      for (const listener of all) {
        listener({ type: event, payload, timestamp });
      }
    }
  }
}

export const wsClient = new WebSocketClient();
