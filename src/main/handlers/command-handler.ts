import { BaseCommand } from '../director-types';

export interface CommandHandler<T extends BaseCommand> {
  execute(command: T): Promise<void>;
}
