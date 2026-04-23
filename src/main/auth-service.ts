import { PublicClientApplication, CryptoProvider } from '@azure/msal-node';
import { shell, BrowserWindow } from 'electron';
import { msalConfig, apiConfig, rcApiScope } from './auth-config';
import { UserProfile } from './director-types';

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
          scopes: [rcApiScope],
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

  async getUserProfile(): Promise<UserProfile | null> {
    const token = await this.getAccessToken();
    if (!token) {
      console.warn('[AuthService] getUserProfile: no access token available');
      return null;
    }

    try {
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.userProfile}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const body = await response.text();
        console.error('[AuthService] Failed to fetch user profile:', response.status, response.statusText, body);
        return null;
      }

      const profile: UserProfile = await response.json();
      console.log('[AuthService] User profile: userId=%s, centerId=%s', profile.userId, profile.centerId || profile.center?.id);
      return profile;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string | null> {
    const tokenCache = this.clientApplication.getTokenCache();
    const accounts = await tokenCache.getAllAccounts();

    if (accounts.length > 0) {
      const account = accounts[0];
      try {
        const response = await this.clientApplication.acquireTokenSilent({
          account: account,
          scopes: [rcApiScope],
          forceRefresh,
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
      scopes: [rcApiScope],
      successTemplate: "<h1>Successfully signed in!</h1> <p>You can close this window now.</p>",
      errorTemplate: "<h1>Something went wrong</h1> <p>Check the console for more information.</p>",
    });

    this.account = authResponse.account;
    return authResponse;
  }
}
