import * as dotenv from 'dotenv';
import { app } from 'electron';
import path from 'path';

if (app.isPackaged) {
  dotenv.config({ path: path.join(process.resourcesPath, '.env') });
} else {
  dotenv.config();
}

export const telemetryConfig = {
  instrumentationKey: process.env.VITE_APPINSIGHTS_INSTRUMENTATION_KEY || 'a3338f9b-48c6-4d3f-b07c-a6e4e4516ea9',
  ingestionEndpoint: process.env.VITE_APPINSIGHTS_INGESTION_ENDPOINT || 'https://westus3-1.in.applicationinsights.azure.com/',
  liveEndpoint: process.env.VITE_APPINSIGHTS_LIVE_ENDPOINT || 'https://westus3.livediagnostics.monitor.azure.com/',
  applicationId: process.env.VITE_APPINSIGHTS_APPLICATION_ID || '7fa3a6e8-91ae-4549-b0de-995d0e8b0c7d',
  enabled: process.env.VITE_APPINSIGHTS_ENABLED !== 'false', // Default to true
  applicationVersion: process.env.npm_package_version || '0.0.7', // Default version
};
