import { CommandHandler } from './command-handler';
import { DriverTtsCommand } from '../director-types';

export class DriverTtsHandler implements CommandHandler<DriverTtsCommand> {
  async execute(command: DriverTtsCommand): Promise<void> {
    const { text, voiceId, channelId } = command.payload;
    console.log(`[STUB] Driver TTS: "${text}"${voiceId ? ` (Voice: ${voiceId})` : ''}${channelId ? ` (Channel: ${channelId})` : ''}`);
    // Future: Implement Gemini TTS + Discord Bot integration here
  }
}
