/**
 * OverlayServer — HTTP + WebSocket server for the overlay host SPA.
 *
 * Serves the overlay SPA static files over HTTP and provides a WebSocket
 * endpoint for real-time overlay state updates. OBS Browser Source connects
 * to this to render overlays.
 *
 * Port is configurable (Decision Q5): default 9100, changeable via Settings.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.3
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { OverlayBus } from './overlay-bus';
import { OverlayServerMessage, OverlaySlot } from './overlay-types';

/** MIME type lookup for static file serving. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export class OverlayServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private overlayBus: OverlayBus;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  /** Root of the Vite build output (dist/). */
  private distRoot: string;
  /** Overlay HTML lives in dist/src/overlay/ (Vite multi-page output). */
  private overlayDir: string;

  constructor(overlayBus: OverlayBus, port: number = 9100) {
    this.overlayBus = overlayBus;
    this.port = port;

    // At runtime __dirname is dist-electron/main/overlay/
    // The Vite output root is at ../../../dist relative to that.
    this.distRoot = path.join(__dirname, '../../../dist');
    this.overlayDir = path.join(this.distRoot, 'src/overlay');

    console.log(`[OverlayServer] Static root: ${this.distRoot} (exists: ${fs.existsSync(this.distRoot)})`);
    console.log(`[OverlayServer] Overlay dir: ${this.overlayDir} (exists: ${fs.existsSync(this.overlayDir)})`);
  }

  /**
   * Start the HTTP + WebSocket server.
   * Non-blocking — server failure doesn't crash the app.
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));

        // WebSocket server on /ws path
        this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
        this.wss.on('connection', (ws) => this.handleConnection(ws));

        // Subscribe to overlay bus events
        this.subscribeToBus();

        // Heartbeat: ping every 30s
        this.heartbeatInterval = setInterval(() => this.heartbeat(), 30000);

        this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`[OverlayServer] Port ${this.port} is already in use. Overlay server not started.`);
          } else {
            console.error(`[OverlayServer] Server error:`, err);
          }
          resolve(); // Don't crash
        });

        this.httpServer.listen(this.port, () => {
          console.log(`[OverlayServer] Listening on http://localhost:${this.port}`);
          console.log(`[OverlayServer] Overlay URL: ${this.getUrl()}`);
          console.log(`[OverlayServer] WebSocket: ws://localhost:${this.port}/ws`);
          resolve();
        });
      } catch (err) {
        console.error('[OverlayServer] Failed to start:', err);
        resolve(); // Don't crash the app
      }
    });
  }

  /**
   * Stop the server and clean up.
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log('[OverlayServer] Server stopped.');
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Get the actual port the server is listening on. */
  getPort(): number {
    return this.port;
  }

  /** Get the overlay URL for OBS Browser Source. */
  getUrl(): string {
    return `http://localhost:${this.port}/overlay`;
  }

  // ─── HTTP Request Handler ──────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

    // API: GET /api/overlays → JSON overlay state
    if (url.pathname === '/api/overlays') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(this.overlayBus.getOverlays()));
      return;
    }

    // API: GET /api/regions → JSON region assignments
    if (url.pathname === '/api/regions') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(this.overlayBus.getRegionAssignments()));
      return;
    }

    // Static assets referenced by the overlay HTML (../../assets/ resolves to /assets/)
    if (url.pathname.startsWith('/assets/')) {
      this.serveFile(path.join(this.distRoot, url.pathname), res);
      return;
    }

    // Overlay SPA: /overlay and /overlay/*
    if (url.pathname === '/overlay' || url.pathname.startsWith('/overlay/')) {
      this.serveOverlay(url.pathname, res);
      return;
    }

    // Root redirect
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/overlay' });
      res.end();
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  /**
   * Serve files from the overlay subdirectory (dist/src/overlay/).
   * Falls back to index.html for SPA client-side routing.
   */
  private serveOverlay(pathname: string, res: http.ServerResponse): void {
    const relativePath = pathname.replace(/^\/overlay\/?/, '') || 'index.html';
    const filePath = path.join(this.overlayDir, relativePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.overlayDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Try the exact file first
    if (fs.existsSync(filePath)) {
      return this.serveFile(filePath, res);
    }

    // SPA fallback: serve index.html for client-side routing
    const indexPath = path.join(this.overlayDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(indexPath));
      return;
    }

    // Before first build, serve a placeholder
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(this.getPlaceholderHtml());
  }

  /**
   * Serve a single file by absolute path with correct MIME type.
   */
  private serveFile(filePath: string, res: http.ServerResponse): void {
    // Security: must be within dist root
    if (!filePath.startsWith(this.distRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  }

  private getPlaceholderHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Overlay</title>
  <style>
    body { margin: 0; background: transparent; color: #666; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
  </style>
</head>
<body>
  <div>Overlay system ready. Build overlay SPA to see content.</div>
</body>
</html>`;
  }

  // ─── WebSocket Handler ─────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    console.log('[OverlayServer] WebSocket client connected.');

    // Send initial state
    const initMsg: OverlayServerMessage = {
      type: 'connected',
      overlays: this.overlayBus.getOverlays(),
    };
    ws.send(JSON.stringify(initMsg));

    // Mark as alive for heartbeat
    (ws as any)._isAlive = true;
    ws.on('pong', () => {
      (ws as any)._isAlive = true;
    });

    ws.on('close', () => {
      console.log('[OverlayServer] WebSocket client disconnected.');
    });

    ws.on('error', (err) => {
      console.error('[OverlayServer] WebSocket error:', err);
    });
  }

  private broadcast(msg: OverlayServerMessage): void {
    if (!this.wss) return;
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private subscribeToBus(): void {
    this.overlayBus.on('registered', (overlay: OverlaySlot) => {
      this.broadcast({ type: 'overlay:registered', overlay });
    });

    this.overlayBus.on('unregistered', (id: string) => {
      this.broadcast({ type: 'overlay:unregistered', id });
    });

    this.overlayBus.on('update', (id: string, data: Record<string, unknown>) => {
      this.broadcast({ type: 'overlay:update', id, data });
    });

    this.overlayBus.on('show', (id: string) => {
      this.broadcast({ type: 'overlay:show', id });
    });

    this.overlayBus.on('hide', (id: string) => {
      this.broadcast({ type: 'overlay:hide', id });
    });
  }

  private heartbeat(): void {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if ((client as any)._isAlive === false) {
        console.log('[OverlayServer] Terminating stale WebSocket client.');
        client.terminate();
        continue;
      }
      (client as any)._isAlive = false;
      client.ping();
    }
  }
}
