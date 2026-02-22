/**
 * ChatTicker — Horizontal scrolling chat message feed.
 *
 * Displays recent chat messages in a ticker-style horizontal scroll.
 * Appears in the ticker region (bottom of screen).
 *
 * Data shape:
 * - messages: Array<{ username: string, text: string, platform?: string }>
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 3.1
 */

import React, { useEffect, useState } from 'react';
import { OverlayTemplateProps } from './index';

interface ChatMessage {
  username: string;
  text: string;
  platform?: string;
}

export const ChatTicker: React.FC<OverlayTemplateProps> = ({ data }) => {
  const messages = (data.messages as ChatMessage[]) ?? [];
  const [translateX, setTranslateX] = useState(0);

  // Animate scrolling left
  useEffect(() => {
    if (messages.length === 0) return;

    let animationFrame: number;
    const startTime = Date.now();
    const scrollSpeed = 50; // pixels per second

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const distance = (elapsed / 1000) * scrollSpeed;
      setTranslateX(-distance);

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [messages]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div style={{
      width: '100%',
      background: 'rgba(17, 19, 23, 0.85)',
      backdropFilter: 'blur(8px)',
      borderTop: '2px solid rgba(255, 95, 31, 0.6)',
      padding: '12px 0',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '48px',
        transform: `translateX(${translateX}px)`,
        whiteSpace: 'nowrap',
      }}>
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {/* Platform badge */}
            {msg.platform && (
              <span style={{
                fontFamily: 'Rajdhani, sans-serif',
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#00A3E0',
                background: 'rgba(0, 163, 224, 0.15)',
                padding: '2px 8px',
                borderRadius: '4px',
              }}>
                {msg.platform}
              </span>
            )}

            {/* Username */}
            <span style={{
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '16px',
              fontWeight: 700,
              color: '#FF5F1F',
              textTransform: 'uppercase',
            }}>
              {msg.username}:
            </span>

            {/* Message text */}
            <span style={{
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '16px',
              fontWeight: 400,
              color: '#E5E7EB',
            }}>
              {msg.text}
            </span>

            {/* Separator */}
            <span style={{
              fontSize: '12px',
              color: 'rgba(229, 231, 235, 0.3)',
              margin: '0 8px',
            }}>
              •
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
