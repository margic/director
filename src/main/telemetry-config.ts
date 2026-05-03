import * as dotenv from 'dotenv';
import { app } from 'electron';
import path from 'path';

if (app.isPackaged) {
  dotenv.config({ path: path.join(process.resourcesPath, '.env') });
} else {
  dotenv.config();
}

export const telemetryConfig = {
  instrumentationKey: process.env.VITE_APPINSIGHTS_INSTRUMENTATION_KEY || '',
  ingestionEndpoint: process.env.VITE_APPINSIGHTS_INGESTION_ENDPOINT || 'https://westus3-1.in.applicationinsights.azure.com/',
  liveEndpoint: process.env.VITE_APPINSIGHTS_LIVE_ENDPOINT || 'https://westus3.livediagnostics.monitor.azure.com/',
  applicationId: process.env.VITE_APPINSIGHTS_APPLICATION_ID || '',
  // Disabled if explicitly set to 'false' OR if no instrumentation key is configured.
  // An empty key causes the App Insights SDK to create a broken client that crashes at runtime.
  enabled: process.env.VITE_APPINSIGHTS_ENABLED !== 'false' && !!process.env.VITE_APPINSIGHTS_INSTRUMENTATION_KEY,
  applicationVersion: app.getVersion(),
  get connectionString() {
    return `InstrumentationKey=${this.instrumentationKey};IngestionEndpoint=${this.ingestionEndpoint};LiveEndpoint=${this.liveEndpoint}`;
  }
};
