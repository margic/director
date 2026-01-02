import { DirectorSequence, CommandType, DirectorCommand } from './director-types';
import { CommandHandler } from './handlers/command-handler';
import { WaitHandler } from './handlers/wait-handler';
import { LogHandler } from './handlers/log-handler';
import { SwitchCameraHandler } from './handlers/switch-camera-handler';
import { SwitchObsSceneHandler } from './handlers/switch-obs-scene-handler';
import { DriverTtsHandler } from './handlers/driver-tts-handler';
import { ViewerChatHandler } from './handlers/viewer-chat-handler';
import { IracingService } from './iracing-service';

export class CommandHandlerRegistry {
  private handlers: Map<CommandType, CommandHandler<any>> = new Map();

  constructor(private iracingService: IracingService) {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.register('WAIT', new WaitHandler());
    this.register('LOG', new LogHandler());
    this.register('SWITCH_CAMERA', new SwitchCameraHandler(this.iracingService));
    this.register('SWITCH_OBS_SCENE', new SwitchObsSceneHandler());
    this.register('DRIVER_TTS', new DriverTtsHandler());
    this.register('VIEWER_CHAT', new ViewerChatHandler());
  }

  register(type: CommandType, handler: CommandHandler<any>) {
    this.handlers.set(type, handler);
  }

  get(type: CommandType): CommandHandler<any> | undefined {
    return this.handlers.get(type);
  }
}

export class SequenceExecutor {
  private registry: CommandHandlerRegistry;

  constructor(iracingService: IracingService) {
    this.registry = new CommandHandlerRegistry(iracingService);
  }

  async execute(sequence: DirectorSequence, onProgress?: (completed: number, total: number) => void): Promise<void> {
    console.log(`Executing sequence ${sequence.id} with ${sequence.commands.length} commands`);
    let completed = 0;
    const total = sequence.commands.length;

    if (onProgress) onProgress(completed, total);

    for (const command of sequence.commands) {
      console.log(`Executing command: [${command.type}]`, JSON.stringify(command.payload));
      
      const handler = this.registry.get(command.type);
      if (handler) {
        try {
          await handler.execute(command);
        } catch (error) {
          console.error(`Error executing command ${command.id} (${command.type}):`, error);
          // Decide: Should we stop the sequence or continue? 
          // For now, we log and continue, but maybe we should throw if it's critical?
          // The spec says "Critical failures might need different handling", but defaults to continue.
        }
      } else {
        console.warn(`No handler registered for command type: ${command.type}`);
      }

      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }
}

