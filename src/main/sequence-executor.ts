import { DirectorSequence } from './director-types';

export class SequenceExecutor {
  async execute(sequence: DirectorSequence): Promise<void> {
    console.log(`Executing sequence ${sequence.id} with ${sequence.commands.length} commands`);
    for (const command of sequence.commands) {
      console.log(`Executing command: ${command.type}`, command.payload);
      // TODO: Implement actual command logic
      if (command.type === 'WAIT') {
        await new Promise(resolve => setTimeout(resolve, (command.payload as any).durationMs));
      }
    }
  }
}
