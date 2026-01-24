import { CommandHandler } from './command-handler';
import { ExecuteIntentCommand } from '../director-types';
import { ExtensionHostService } from '../extension-host/extension-host';

export class ExecuteIntentHandler implements CommandHandler<ExecuteIntentCommand> {
  constructor(private extensionHost: ExtensionHostService) {}

  async execute(command: ExecuteIntentCommand): Promise<void> {
    const { intent, payload } = command.payload;
    console.log(`[SequenceExecutor] Executing intent '${intent}' via extensions.`);
    
    // Delegate to extension host
    // We don't await the result from the extension process IPC in this version of the 'executeIntent' method
    // unless we update ExtensionHostService to return a promise that resolves when the extension is done.
    // For now, it's fire and forget from the Director's perspective, or we assume it's quick.
    // TODO: Make ExecuteIntent awaitable if we need to sync with extension operations.
    
    await this.extensionHost.executeIntent(intent, payload);
  }
}
