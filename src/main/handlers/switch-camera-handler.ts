import { CommandHandler } from './command-handler';
import { SwitchCameraCommand } from '../director-types';
import { IracingService, IRSDK_CAM_SWITCHNUM } from '../iracing-service';

export class SwitchCameraHandler implements CommandHandler<SwitchCameraCommand> {
  constructor(private iracingService: IracingService) {}

  async execute(command: SwitchCameraCommand): Promise<void> {
    const { carNumber, cameraGroupNumber, cameraGroupName } = command.payload;
    console.log(`Switching camera to Car ${carNumber} - Group: ${cameraGroupName || cameraGroupNumber}`);
    
    const carNum = parseInt(String(carNumber), 10);
    const groupNum = parseInt(String(cameraGroupNumber), 10);

    if (isNaN(carNum) || isNaN(groupNum)) {
        console.error('Invalid camera switch parameters', command.payload);
        return;
    }

    this.iracingService.broadcastMessage(IRSDK_CAM_SWITCHNUM, carNum, groupNum, 0);
  }
}
