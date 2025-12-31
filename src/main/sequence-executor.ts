import { DirectorSequence } from './director-types';

export class SequenceExecutor {
  async execute(sequence: DirectorSequence, onProgress?: (completed: number, total: number) => void): Promise<void> {
    console.log(`Executing sequence ${sequence.id} with ${sequence.commands.length} commands`);
    let completed = 0;
    const total = sequence.commands.length;

    if (onProgress) onProgress(completed, total);

    for (const command of sequence.commands) {
      console.log(`Executing command:`, JSON.stringify(command, null, 2));
      // TODO: Implement actual command logic
      if (command.type === 'WAIT') {
        await new Promise(resolve => setTimeout(resolve, (command.payload as any).durationMs));
      }
      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }
}
