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
      logLevel: 3,
    },
  },
};
