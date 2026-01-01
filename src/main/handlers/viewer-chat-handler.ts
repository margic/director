import { CommandHandler } from './command-handler';
import { ViewerChatCommand } from '../director-types';

export class ViewerChatHandler implements CommandHandler<ViewerChatCommand> {
  async execute(command: ViewerChatCommand): Promise<void> {
    const { platform, message } = command.payload;
    console.log(`[STUB] Viewer Chat (${platform}): "${message}"`);
    // Future: Implement YouTube/Twitch API integration here
  }
}
