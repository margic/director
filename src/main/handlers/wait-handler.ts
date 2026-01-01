import { CommandHandler } from './command-handler';
import { WaitCommand } from '../director-types';

export class WaitHandler implements CommandHandler<WaitCommand> {
  async execute(command: WaitCommand): Promise<void> {
    const { durationMs } = command.payload;
    if (durationMs > 0) {
      await new Promise(resolve => setTimeout(resolve, durationMs));
    }
  }
}
