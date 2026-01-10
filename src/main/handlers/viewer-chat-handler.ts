import { CommandHandler } from './command-handler';
import { ViewerChatCommand } from '../director-types';
import { youtubeService } from '../youtube-service';

export class ViewerChatHandler implements CommandHandler<ViewerChatCommand> {
  async execute(command: ViewerChatCommand): Promise<void> {
    const { platform, message } = command.payload;
    
    if (platform === 'YOUTUBE') {
        const result = await youtubeService.postMessage(message);
        if (!result) {
            console.warn('[ViewerChat] Failed to send message to YouTube (Not connected?)');
        } else {
            console.log('[ViewerChat] Message sent to YouTube');
        }
    } else {
        console.warn(`[ViewerChat] Platform ${platform} not yet supported.`);
    }
  }
}
