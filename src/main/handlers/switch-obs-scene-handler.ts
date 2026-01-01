import { CommandHandler } from './command-handler';
import { SwitchObsSceneCommand } from '../director-types';

export class SwitchObsSceneHandler implements CommandHandler<SwitchObsSceneCommand> {
  async execute(command: SwitchObsSceneCommand): Promise<void> {
    const { sceneName, transition, duration } = command.payload;
    console.log(`[STUB] Switching OBS Scene to '${sceneName}'${transition ? ` via ${transition}` : ''}${duration ? ` (${duration}ms)` : ''}`);
    // Future: Implement OBS WebSocket integration here
  }
}
