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
import { apiConfig } from './auth-config';
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

          this.client!.once('ready', async () => {
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
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                text,
                voiceId // Optional: Pass voiceId if the API supports it
            })
        });

        if (!response.ok) {
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
