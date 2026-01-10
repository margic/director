// src/renderer/youtube-types.ts

export type YouTubeConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export interface YouTubeState {
  status: YouTubeConnectionStatus;
  channelId?: string;
  channelTitle?: string;
  videoId?: string;
  videoTitle?: string;
  messageCount: number;
}

export interface YouTubeSearchResult {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
}
