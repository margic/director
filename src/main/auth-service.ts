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

  async getAccount(): Promise<any> {
    const tokenCache = this.clientApplication.getTokenCache();
    const accounts = await tokenCache.getAllAccounts();

    if (accounts.length > 0) {
      const account = accounts[0];
      try {
        const response = await this.clientApplication.acquireTokenSilent({
          account: account,
          scopes: ["User.Read"],
        });
        this.account = response.account;
        return this.account;
      } catch (error) {
        console.log('Silent token acquisition failed', error);
        return null;
      }
    }
    return null;
  }

  async getAccessToken(): Promise<string | null> {
    const tokenCache = this.clientApplication.getTokenCache();
    const accounts = await tokenCache.getAllAccounts();

    if (accounts.length > 0) {
      const account = accounts[0];
      try {
        const response = await this.clientApplication.acquireTokenSilent({
          account: account,
          scopes: ["User.Read"],
        });
        return response.accessToken;
      } catch (error) {
        console.log('Silent token acquisition failed', error);
        return null;
      }
    }
    return null;
  }

  async logout(): Promise<void> {
    const tokenCache = this.clientApplication.getTokenCache();
    const accounts = await tokenCache.getAllAccounts();
    for (const account of accounts) {
      await tokenCache.removeAccount(account);
    }
    this.account = null;
  }

  private async getTokenInteractive(mainWindow: BrowserWindow): Promise<any> {
    const openBrowser = async (url: string) => {
      console.log('Opening browser with URL:', url);
      try {
        await shell.openExternal(url);
      } catch (error) {
        console.error('Failed to open browser:', error);
      }
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
