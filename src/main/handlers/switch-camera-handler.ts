import { CommandHandler } from './command-handler';
import { SwitchCameraCommand } from '../director-types';
import { ExtensionHostService } from '../extension-host/extension-host';

export class SwitchCameraHandler implements CommandHandler<SwitchCameraCommand> {
  constructor(private extensionHost: ExtensionHostService) {}

  async execute(command: SwitchCameraCommand): Promise<void> {
    const { carNumber, cameraGroupNumber, cameraGroupName } = command.payload;
    console.log(`Switching camera to Car ${carNumber} - Group: ${cameraGroupName || cameraGroupNumber}`);
    
    // Dispatch to Extension via Intent
    // Intent: broadcast.showLiveCam { carNum, camGroup }
    
    await this.extensionHost.executeIntent('broadcast.showLiveCam', {
        carNum: String(carNumber),
        camGroup: String(cameraGroupNumber || 0)
    });
  }
}
