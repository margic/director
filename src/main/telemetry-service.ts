import * as appInsights from 'applicationinsights';
import { KnownSeverityLevel } from 'applicationinsights/out/src/declarations/generated';
import { telemetryConfig } from './telemetry-config';

/**
 * TelemetryService provides centralized telemetry tracking for the Director application.
 * It integrates with Azure Application Insights to enable remote observability and
 * correlation with the backend services.
 */
export class TelemetryService {
  private client: appInsights.TelemetryClient | null = null;
  private initialized = false;

  /**
   * Initialize Application Insights telemetry
   */
  initialize(): void {
    if (this.initialized || !telemetryConfig.enabled) {
      console.log('Telemetry already initialized or disabled');
      return;
    }

    try {
      // Configure Application Insights
      appInsights.setup(telemetryConfig.instrumentationKey)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true, false)
        .setUseDiskRetryCaching(true)
        .setSendLiveMetrics(false)
        .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
        .start();

      this.client = appInsights.defaultClient;

      // Configure ingestion endpoint
      if (this.client) {
        this.client.config.endpointUrl = telemetryConfig.ingestionEndpoint;
        
        // Set common properties for all telemetry
        this.client.commonProperties = {
          application: 'SimRaceCenter-Director',
          version: require('../../package.json').version || 'unknown',
          environment: process.env.NODE_ENV || 'production',
        };

        console.log('Application Insights initialized successfully');
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Application Insights:', error);
    }
  }

  /**
   * Track a custom event
   */
  trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
    if (!this.client) return;
    
    this.client.trackEvent({
      name,
      properties,
      measurements,
    });
  }

  /**
   * Track a metric
   */
  trackMetric(name: string, value: number, properties?: { [key: string]: string }): void {
    if (!this.client) return;
    
    this.client.trackMetric({
      name,
      value,
      properties,
    });
  }

  /**
   * Track an exception
   */
  trackException(exception: Error, properties?: { [key: string]: string }): void {
    if (!this.client) return;
    
    this.client.trackException({
      exception,
      properties,
    });
  }

  /**
   * Track a dependency (external API call)
   */
  trackDependency(
    name: string,
    commandName: string,
    duration: number,
    success: boolean,
    resultCode?: number,
    dependencyTypeName?: string,
    properties?: { [key: string]: string }
  ): void {
    if (!this.client) return;
    
    this.client.trackDependency({
      name,
      data: commandName,
      duration,
      success,
      resultCode,
      dependencyTypeName: dependencyTypeName || 'HTTP',
      properties,
    });
  }

  /**
   * Track a trace/log message
   */
  trackTrace(message: string, severity?: KnownSeverityLevel | number, properties?: { [key: string]: string }): void {
    if (!this.client) return;
    
    // Convert severity enum to string if needed
    const severityValue = typeof severity === 'number' 
      ? Object.values(KnownSeverityLevel)[severity] 
      : severity || KnownSeverityLevel.Information;
    
    this.client.trackTrace({
      message,
      severity: severityValue,
      properties,
    });
  }

  /**
   * Flush telemetry data (useful before app shutdown)
   */
  async flush(): Promise<void> {
    if (!this.client) return;
    
    return new Promise((resolve) => {
      // The flush method doesn't take a callback parameter in newer versions
      // Use a timeout to ensure telemetry is sent
      this.client!.flush();
      setTimeout(() => {
        console.log('Telemetry flushed');
        resolve();
      }, 2000);
    });
  }

  /**
   * Get the telemetry client instance (for advanced usage)
   */
  getClient(): appInsights.TelemetryClient | null {
    return this.client;
  }

  /**
   * Check if telemetry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const telemetryService = new TelemetryService();
