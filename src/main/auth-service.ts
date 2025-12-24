import { PublicClientApplication, CryptoProvider } from '@azure/msal-node';
import { shell, BrowserWindow } from 'electron';
import { msalConfig } from './auth-config';

export class AuthService {
  private clientApplication: PublicClientApplication;
  private account: any;

  constructor() {
    this.clientApplication = new PublicClientApplication(msalConfig);
  }

  async login(mainWindow: BrowserWindow): Promise<any> {
    const authResponse = await this.getTokenInteractive(mainWindow);
    return authResponse?.account;
  }

  async logout(): Promise<void> {
    this.account = null;
    // Clear cache if needed
  }

  private async getTokenInteractive(mainWindow: BrowserWindow): Promise<any> {
    const openBrowser = async (url: string) => {
      await shell.openExternal(url);
    };

    const authResponse = await this.clientApplication.acquireTokenInteractive({
      openBrowser,
      scopes: ["User.Read"],
      successTemplate: "<h1>Successfully signed in!</h1> <p>You can close this window now.</p>",
      errorTemplate: "<h1>Something went wrong</h1> <p>Check the console for more information.</p>",
    });

    this.account = authResponse.account;
    return authResponse;
  }
}
