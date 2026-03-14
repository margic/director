import * as dotenv from 'dotenv';
import { app } from 'electron';
import path from 'path';
import { cachePlugin } from './cache-plugin';

if (app.isPackaged) {
  dotenv.config({ path: path.join(process.resourcesPath, '.env') });
} else {
  dotenv.config();
}

export const msalConfig = {
  auth: {
    clientId: process.env.VITE_AZURE_CLIENT_ID || "",
    authority: `https://login.microsoftonline.com/${process.env.VITE_AZURE_TENANT_ID || "common"}`,
  },
  cache: {
    cachePlugin
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel: any, message: any, containsPii: any) {
        console.log(message);
      },
      piiLoggingEnabled: false,
      logLevel: 1, // Warning
    },
  },
};

/**
 * Race Control API scope for token acquisition.
 * The Director must request this scope (not User.Read) so the access token
 * is issued with the Race Control API audience.
 */
export const rcApiScope =
  process.env.VITE_RC_API_SCOPE ||
  'api://racecontrol-api-a780e279-1cb6-4ed0-9ef6-49029aa50a42/access_as_user';

export const apiConfig = {
  baseUrl: process.env.VITE_API_BASE_URL || 'https://simracecenter.com',
  endpoints: {
    userProfile: '/api/auth/user',
    listSessions: '/api/director/v1/sessions',
    nextSequence: (sessionId: string) => `/api/director/v1/sessions/${sessionId}/sequences/next`,
    getSequence: (sequenceId: string) => `/api/director/v1/sequences/${sequenceId}`,
    tts: '/api/tts',
  },
};
