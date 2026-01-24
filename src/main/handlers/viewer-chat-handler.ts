import { CommandHandler } from './command-handler';
import { ViewerChatCommand } from '../director-types';
import { ExtensionHostService } from '../extension-host/extension-host';

export class ViewerChatHandler implements CommandHandler<ViewerChatCommand> {
  constructor(private extensionHost: ExtensionHostService) {}

  async execute(command: ViewerChatCommand): Promise<void> {
    const { platform, message } = command.payload;
    
    if (platform === 'YOUTUBE') {
        await this.extensionHost.executeIntent('communication.talkToChat', { message });
        console.log('[ViewerChat] Message dispatched to YouTube Extension');
    } else {
        console.warn(`[ViewerChat] Platform ${platform} not yet supported.`);
    }
  }
}
