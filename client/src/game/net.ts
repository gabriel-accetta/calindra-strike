import type { ClientMsg, ServerMsg } from '@calindra-strike/shared';

/** Thin WebSocket wrapper with defensive JSON parsing. */
export class Connection {
  private ws: WebSocket;
  private handlers: ((m: ServerMsg) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  bytesIn = 0;
  private openPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Não foi possível conectar ao servidor')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      this.bytesIn += e.data.length;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      for (const h of this.handlers) h(m);
    });
    this.ws.addEventListener('close', (e) => {
      for (const h of this.closeHandlers) h(e.code, e.reason);
    });
  }

  opened(): Promise<void> {
    return this.openPromise;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(m: ClientMsg | Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  onMessage(h: (m: ServerMsg) => void): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }

  onClose(h: (code: number, reason: string) => void): void {
    this.closeHandlers.push(h);
  }

  close(): void {
    this.ws.close();
  }
}
