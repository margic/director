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

export const apiConfig = {
  baseUrl: process.env.VITE_API_BASE_URL || 'https://dev-api.simracecenter.com',
  endpoints: {
    userProfile: '/api/auth/user',
    listSessions: '/api/director/v1/sessions',
    nextSequence: (sessionId: string) => `/api/director/v1/sessions/${sessionId}/sequences/next`,
    getSequence: (sequenceId: string) => `/api/director/v1/sequences/${sequenceId}`,
    tts: '/api/tts',
  },
};
