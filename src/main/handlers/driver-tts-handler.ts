import { CommandHandler } from './command-handler';
import { DriverTtsCommand } from '../director-types';
import { discordService } from '../discord-service';

export class DriverTtsHandler implements CommandHandler<DriverTtsCommand> {
  async execute(command: DriverTtsCommand): Promise<void> {
    const { text, voiceId, channelId } = command.payload;
    // Route the command to the Discord Service for Output
    await discordService.playTts(text, voiceId);
  }
}
