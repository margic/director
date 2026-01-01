import { CommandHandler } from './command-handler';
import { LogCommand } from '../director-types';

export class LogHandler implements CommandHandler<LogCommand> {
  async execute(command: LogCommand): Promise<void> {
    const { message, level } = command.payload;
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [DIRECTOR-LOG] [${level}] ${message}`;

    switch (level) {
      case 'ERROR':
        console.error(logMessage);
        break;
      case 'WARN':
        console.warn(logMessage);
        break;
      case 'INFO':
      default:
        console.log(logMessage);
        break;
    }
  }
}
