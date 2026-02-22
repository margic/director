/**
 * useOverlaySocket — WebSocket hook for real-time overlay updates.
 *
 * Connects to the OverlayServer WebSocket, processes messages,
 * and maintains a reactive map of overlay slots.
 * Reconnects with exponential backoff on disconnect.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.4
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/** Mirror of OverlaySlot from overlay-types.ts (duplicated to avoid main→renderer import) */
export interface OverlaySlot {
  id: string;
  region: string;
  title: string;
  template: string;
  autoHide?: number;
  priority?: number;
  extensionId: string;
  data?: Record<string, unknown>;
  visible: boolean;
}

type OverlayServerMessage =
  | { type: 'connected'; overlays: OverlaySlot[] }
  | { type: 'overlay:registered'; overlay: OverlaySlot }
  | { type: 'overlay:update'; id: string; data: Record<string, unknown> }
  | { type: 'overlay:show'; id: string }
  | { type: 'overlay:hide'; id: string }
  | { type: 'overlay:unregistered'; id: string };

export interface UseOverlaySocketResult {
  overlays: Map<string, OverlaySlot>;
  connected: boolean;
}

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

export function useOverlaySocket(url: string): UseOverlaySocketResult {
  const [overlays, setOverlays] = useState<Map<string, OverlaySlot>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const processMessage = useCallback((msg: OverlayServerMessage) => {
    switch (msg.type) {
      case 'connected': {
        const map = new Map<string, OverlaySlot>();
        for (const overlay of msg.overlays) {
          const key = `${overlay.extensionId}.${overlay.id}`;
          map.set(key, overlay);
        }
        setOverlays(map);
        break;
      }

      case 'overlay:registered': {
        setOverlays((prev) => {
          const next = new Map(prev);
          const key = `${msg.overlay.extensionId}.${msg.overlay.id}`;
          next.set(key, msg.overlay);
          return next;
        });
        break;
      }

      case 'overlay:update': {
        setOverlays((prev) => {
          const next = new Map(prev);
          const slot = next.get(msg.id);
          if (slot) {
            next.set(msg.id, { ...slot, data: { ...slot.data, ...msg.data } });
          }
          return next;
        });
        break;
      }

      case 'overlay:show': {
        setOverlays((prev) => {
          const next = new Map(prev);
          const slot = next.get(msg.id);
          if (slot) {
            next.set(msg.id, { ...slot, visible: true });
          }
          return next;
        });
        break;
      }

      case 'overlay:hide': {
        setOverlays((prev) => {
          const next = new Map(prev);
          const slot = next.get(msg.id);
          if (slot) {
            next.set(msg.id, { ...slot, visible: false });
          }
          return next;
        });
        break;
      }

      case 'overlay:unregistered': {
        setOverlays((prev) => {
          const next = new Map(prev);
          next.delete(msg.id);
          return next;
        });
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.log('[OverlaySocket] Connected');
        setConnected(true);
        reconnectDelayRef.current = MIN_RECONNECT_MS; // Reset backoff
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string) as OverlayServerMessage;
          processMessage(msg);
        } catch (err) {
          console.error('[OverlaySocket] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        console.log('[OverlaySocket] Disconnected. Reconnecting...');
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('[OverlaySocket] Error:', err);
        ws.close();
      };
    } catch (err) {
      console.error('[OverlaySocket] Connection failed:', err);
      scheduleReconnect();
    }
  }, [url, processMessage]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    const delay = reconnectDelayRef.current;
    console.log(`[OverlaySocket] Reconnecting in ${delay}ms...`);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { overlays, connected };
}
