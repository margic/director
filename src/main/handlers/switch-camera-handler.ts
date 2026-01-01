import { CommandHandler } from './command-handler';
import { SwitchCameraCommand } from '../director-types';

export class SwitchCameraHandler implements CommandHandler<SwitchCameraCommand> {
  async execute(command: SwitchCameraCommand): Promise<void> {
    const { carNumber, cameraGroup, cameraNumber } = command.payload;
    console.log(`[STUB] Switching camera to Car ${carNumber} - Group: ${cameraGroup}${cameraNumber ? ` - Cam: ${cameraNumber}` : ''}`);
    // Future: Implement iRacing SDK integration here
  }
}
