import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  VoiceConnection, 
  VoiceConnectionStatus,
  AudioPlayer,
  NoSubscriberBehavior
} from '@discordjs/voice';
import { Readable } from 'stream';
import { app } from 'electron';
import path from 'path';
import { apiConfig } from './auth-config';

// prism-media discovers FFmpeg via require('ffmpeg-static'), but in a
// packaged Electron build the binary lives inside app.asar which cannot
// be spawned.  We resolve the correct path and force-register it with
// prism-media's FFmpeg class *before* @discordjs/voice ever uses it.
import { FFmpeg as PrismFFmpeg } from 'prism-media';
import { spawnSync } from 'child_process';

(() => {
  let ffmpegPath: string;
  if (app.isPackaged) {
    ffmpegPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require('ffmpeg-static');
  }
  // Force prism-media to accept this path by pre-populating its cache
  // via getInfo(true) won't help because require() inside asar still fails.
  // Instead, we spawnSync ourselves and monkey-patch the static info.
  try {
    const result = spawnSync(ffmpegPath, ['-h'], { windowsHide: true });
    if (!result.error) {
      const output = Buffer.concat(result.output.filter(Boolean) as Buffer[]).toString();
      // Access the internal FFMPEG cache via getInfo() structure
      // After calling getInfo once with our patched path, it will be cached.
      (PrismFFmpeg as any).getInfo = (force = false) => {
        return { command: ffmpegPath, output, get version() { return (/version (.+) Copyright/mi.exec(output) || [])[1] || 'unknown'; } };
      };
      console.log('[Discord] FFmpeg resolved:', ffmpegPath);
    } else {
      console.error('[Discord] FFmpeg binary not executable:', result.error.message);
    }
  } catch (err: any) {
    console.error('[Discord] Failed to initialize FFmpeg:', err.message);
  }
})();
import { AuthService } from './auth-service';
import { TelemetryService } from './telemetry-service';

// Remove discord-discord-tts import
// eslint-disable-next-line @typescript-eslint/no-require-imports
// const discordTTS = require('discord-tts');

export interface DiscordStatus {
  connected: boolean;
  channelName?: string;
  lastMessage?: string;
  messagesSent: number;
}

export class DiscordService {
  private client: Client | null = null;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private authService: AuthService | null = null;
  private telemetryService: TelemetryService | null = null;
  
  private status: DiscordStatus = {
    connected: false,
    messagesSent: 0
  };

  constructor() {
    this.status.connected = false;
  }

  public setAuthService(authService: AuthService) {
    this.authService = authService;
  }

  public setTelemetryService(telemetryService: TelemetryService) {
      this.telemetryService = telemetryService;
  }

  public getStatus(): DiscordStatus {
    return this.status;
  }

  /**
   * Connect to Discord Gateway and Voice Channel
   */
  public async connect(token: string, channelId: string): Promise<void> {
      console.log(`[DiscordService] Connecting with token to channel ${channelId}...`);
      
      // Cleanup existing connection
      if (this.client) {
          await this.disconnect();
      }

      // Initialize Client
      this.client = new Client({
          intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildVoiceStates
          ]
      });

      return new Promise<void>((resolve, reject) => {
          // Timeout protection
          const connectionTimeout = setTimeout(() => {
              reject(new Error('Connection timed out'));
          }, 15000);

          this.client!.once('clientReady', async () => {
              console.log(`[DiscordService] Bot logged in as ${this.client?.user?.tag}`);
              try {
                  const channel = await this.client?.channels.fetch(channelId);
                  
                  if (!channel) {
                      throw new Error(`Channel ${channelId} not found`);
                  }
                  
                  // Discord.js types are strict, verify it's a voice channel
                  // In v14, we check type or isVoiceBased()
                  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
                       throw new Error(`Channel ${channelId} is not a Voice Channel (Type: ${channel.type})`);
                  }
                  
                  // Need to cast to VoiceBasedChannel or similar if TS complains, but fetch returns generic Channel
                  // However, joinVoiceChannel needs guildId and adapterCreator.
                  const guildCallback = (channel as any).guild;

                  console.log(`[DiscordService] Joining channel: ${channel.id} in Guild: ${guildCallback.id}`);

                  // Join Voice Channel
                  this.connection = joinVoiceChannel({
                      channelId: channel.id,
                      guildId: guildCallback.id,
                      adapterCreator: guildCallback.voiceAdapterCreator,
                  });

                  this.connection.on(VoiceConnectionStatus.Ready, () => {
                      clearTimeout(connectionTimeout);
                      console.log('[DiscordService] Voice Connection Ready');
                      this.status.connected = true;
                      this.status.channelName = (channel as any).name;
                      
                      // Create Audio Player
                      this.player = createAudioPlayer({
                          behaviors: {
                              noSubscriber: NoSubscriberBehavior.Play
                          }
                      });
                      
                      // Subscribe connection to player
                      this.connection?.subscribe(this.player);
                      
                      this.player.on('error', error => {
                          console.error('[DiscordService] Audio Player Error:', error);
                      });

                      resolve();
                  });

                  this.connection.on(VoiceConnectionStatus.Disconnected, () => {
                       console.log('[DiscordService] Voice Disconnected');
                       this.status.connected = false;
                  });
                  
                  this.connection.on(VoiceConnectionStatus.Signalling, () => {
                      console.log('[DiscordService] Voice Signalling...');
                  });

              } catch (err) {
                  clearTimeout(connectionTimeout);
                  console.error('[DiscordService] Failed to join channel:', err);
                  reject(err);
              }
          });

          this.client!.login(token).catch((err) => {
              clearTimeout(connectionTimeout);
              console.error('[DiscordService] Login failed:', err);
              reject(err);
          });
      });
  }

  public async disconnect() {
      console.log('[DiscordService] Disconnecting...');
      if (this.connection) {
          this.connection.destroy();
          this.connection = null;
      }
      if (this.client) {
          await this.client.destroy();
          this.client = null;
      }
      this.status.connected = false;
      this.status.channelName = undefined;
      this.player = null;
  }

  /**
   * Play TTS stream to the connected voice channel.
   */
  public async playTts(text: string, voiceId?: string) {
    console.log(`[DiscordService] Playing TTS: "${text}" (Voice: ${voiceId || 'default'})`);
    
    if (!this.status.connected || !this.player) {
        const msg = 'Cannot play audio: Not connected to Voice Channel';
        console.warn(`[DiscordService] ${msg}`);
        throw new Error(msg);
    }

    if (!this.authService) {
        const msg = 'Cannot play TTS: AuthService not initialized';
        console.error(`[DiscordService] ${msg}`);
        throw new Error(msg);
    }

    try {
        const token = await this.authService.getAccessToken();
        if (!token) {
            const msg = 'Cannot play TTS: No access token';
            console.error(`[DiscordService] ${msg}`);
            throw new Error(msg);
        }

        const url = `${apiConfig.baseUrl}${apiConfig.endpoints.tts}`;
        
        // Construct minimal payload according to OpenAPI spec
        // We omit 'context' to avoid potential server-side parsing issues with optional fields
        // and because the previous 'voiceId' field caused issues.
        const payload = {
            text
        };

        console.log(`[DiscordService] Sending TTS request to ${url} with payload:`, JSON.stringify(payload));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'audio/wav' 
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            // Log the raw response text in case the 500 contains a useful error message
             const errorText = await response.text();
             console.error(`[DiscordService] TTS API Error Body: ${errorText}`);
            throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        console.log(`[DiscordService] TTS Response: ${response.status}, Type: ${contentType}`);

        // Convert Response to buffer for Discord.js
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        console.log(`[DiscordService] TTS Buffer Size: ${buffer.length} bytes`);
        
        // Telemetry: Track TTS success
        this.telemetryService?.trackEvent('Discord.TTS.Received', {
             contentType: contentType || 'unknown',
             status: response.status.toString(),
             textLength: text.length.toString()
        }, {
             sizeBytes: buffer.length
        });

        if (buffer.length < 1000) {
            // Suspiciously small, might be an error or JSON
            const textBody = buffer.toString('utf-8');
            console.log(`[DiscordService] Small response body: ${textBody}`);
        }

        const stream = Readable.from(buffer);
        
        // Create Resource
        const resource = createAudioResource(stream, {
            inlineVolume: true 
        });
        
        // Set volume if needed (optional)
        resource.volume?.setVolume(1.0);

        // Play
        this.player.play(resource);
        
        this.status.lastMessage = text;
        this.status.messagesSent++;

        this.telemetryService?.trackEvent('Discord.TTS.Played', {
             voiceId: voiceId || 'default'
        });
        console.log('[DiscordService] Audio resource queued');
    } catch (err) {
        console.error('[DiscordService] Error playing TTS:', err);
        this.telemetryService?.trackException(err as Error, {
            component: 'DiscordService',
            action: 'playTts',
            textLength: text.length.toString()
        });
        // Rethrow so the UI knows it failed
        throw err;
    }
  }
}

export const discordService = new DiscordService();
