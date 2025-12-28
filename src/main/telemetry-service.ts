import * as appInsights from 'applicationinsights';
import { KnownSeverityLevel } from 'applicationinsights/out/src/declarations/generated';
import { telemetryConfig } from './telemetry-config';

// Severity mapping for IPC calls from renderer
export const SEVERITY_MAP: { [key: string]: KnownSeverityLevel } = {
  'Verbose': KnownSeverityLevel.Verbose,
  'Information': KnownSeverityLevel.Information,
  'Warning': KnownSeverityLevel.Warning,
  'Error': KnownSeverityLevel.Error,
  'Critical': KnownSeverityLevel.Critical,
};

// Numeric to enum mapping
export const NUMERIC_SEVERITY_MAP: KnownSeverityLevel[] = [
  KnownSeverityLevel.Verbose,      // 0
  KnownSeverityLevel.Information,  // 1
  KnownSeverityLevel.Warning,      // 2
  KnownSeverityLevel.Error,        // 3
  KnownSeverityLevel.Critical,     // 4
];

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
          version: telemetryConfig.applicationVersion,
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
    
    // Convert numeric severity to KnownSeverityLevel if needed
    let severityValue: KnownSeverityLevel;
    if (typeof severity === 'number') {
      severityValue = NUMERIC_SEVERITY_MAP[severity] || KnownSeverityLevel.Information;
    } else {
      severityValue = severity || KnownSeverityLevel.Information;
    }
    
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
    
    try {
      await this.client.flush();
      console.log('Telemetry flushed');
    } catch (error) {
      console.error('Failed to flush telemetry:', error);
    }
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
