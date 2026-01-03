import { CommandHandler } from './command-handler';
import { SwitchObsSceneCommand } from '../director-types';
import { ObsService } from '../obs-service';

export class SwitchObsSceneHandler implements CommandHandler<SwitchObsSceneCommand> {
  constructor(private obsService: ObsService) {}

  async execute(command: SwitchObsSceneCommand): Promise<void> {
    const { sceneName } = command.payload;
    console.log(`Switching OBS Scene to '${sceneName}'`);
    await this.obsService.switchScene(sceneName);
  }
}
