import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  NoSubscriberBehavior,
  AudioPlayerStatus
} from '@discordjs/voice';
import { Readable } from 'stream';

// The API interface available in the extension host
interface ExtensionAPI {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

let client: Client | null = null;
let player: any = null;
let connection: any = null;

// Use dev as fallback if not provided
const API_BASE = process.env.VITE_API_BASE_URL || 'https://api.simracecenter.com'; 

export async function activate(director: ExtensionAPI) {
    director.log('info', 'Discord Extension Activating...');

    const token = director.settings['discord.token'];
    const channelId = director.settings['discord.channelId'];

    if (!token || !channelId) {
        director.log('warn', 'Discord extension missing configuration (token or channelId). Check Director Settings.');
    } else {
        connectToDiscord(token, channelId, director);
    }

    director.registerIntentHandler('communication.announce', async (payload: { message: string }) => {
        director.log('info', `Received announce request: ${payload.message}`);
        await playTts(payload.message, director);
    });
}

function connectToDiscord(token: string, channelId: string, director: ExtensionAPI) {
    client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });

    client.once('clientReady', async () => {
        director.log('info', `Discord Bot logged in as ${client?.user?.tag}`);
        try {
            const channel = await client?.channels.fetch(channelId);
            if (channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)) {
                 connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: (channel as any).guild.id,
                    adapterCreator: (channel as any).guild.voiceAdapterCreator,
                 });
                 
                 player = createAudioPlayer({
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Play
                    }
                 });
                 
                 player.on(AudioPlayerStatus.Playing, () => {
                    director.log('info', 'Audio output started');
                 });
                 
                 player.on('error', (error: any) => {
                    director.log('error', `Audio player error: ${error.message}`);
                 });

                 connection.subscribe(player);
                 director.log('info', 'Joined voice channel successfully.');
            } else {
                director.log('warn', 'Channel not found or not a voice channel.');
            }
        } catch (err: any) {
            director.log('error', `Failed to join channel: ${err.message}`);
        }
    });

    client.login(token).catch(err => {
        director.log('error', `Discord Login Failed: ${err.message}`);
    });
}

async function playTts(text: string, director: ExtensionAPI) {
    if (!player) {
         director.log('warn', 'TTS requested but player not initialized.');
         return;
    }

    // Get Auth Token for TTS API
    const authToken = await director.getAuthToken();
    if (!authToken) {
        director.log('error', 'Cannot play TTS: No auth token available.');
        return;
    }

    try {
        const url = `${API_BASE}/api/tts`; 
        
        director.log('info', `Fetching TTS from ${url}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
                'Accept': 'audio/wav'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
             const errText = await response.text();
             throw new Error(`TTS API error: ${response.status} - ${errText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);
        
        const resource = createAudioResource(stream, { inlineVolume: true });
        resource.volume?.setVolume(1.0);
        
        player.play(resource);
        
        director.log('info', 'TTS resource queued.');
    } catch (err: any) {
        director.log('error', `TTS Failed: ${err.message}`);
    }
}
