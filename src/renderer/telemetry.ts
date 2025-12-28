/**
 * Client-side telemetry wrapper for the renderer process.
 * Sends telemetry events to the main process via IPC.
 */

interface TelemetryEvent {
  name: string;
  properties?: { [key: string]: string };
  measurements?: { [key: string]: number };
}

interface TelemetryException {
  error: Error;
  properties?: { [key: string]: string };
}

interface TelemetryTrace {
  message: string;
  severity?: 'Verbose' | 'Information' | 'Warning' | 'Error' | 'Critical';
  properties?: { [key: string]: string };
}

class ClientTelemetry {
  /**
   * Track a custom event from the renderer process
   */
  trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }): void {
    try {
      if (window.electronAPI?.telemetry?.trackEvent) {
        window.electronAPI.telemetry.trackEvent(name, properties, measurements);
      } else {
        console.log('[Telemetry]', name, properties, measurements);
      }
    } catch (error) {
      console.error('Failed to track event:', error);
    }
  }

  /**
   * Track an exception from the renderer process
   */
  trackException(error: Error, properties?: { [key: string]: string }): void {
    try {
      if (window.electronAPI?.telemetry?.trackException) {
        window.electronAPI.telemetry.trackException({
          message: error.message,
          stack: error.stack,
          name: error.name,
        }, properties);
      } else {
        console.error('[Telemetry Exception]', error, properties);
      }
    } catch (err) {
      console.error('Failed to track exception:', err);
    }
  }

  /**
   * Track a trace/log message from the renderer process
   */
  trackTrace(message: string, severity?: 'Verbose' | 'Information' | 'Warning' | 'Error' | 'Critical', properties?: { [key: string]: string }): void {
    try {
      if (window.electronAPI?.telemetry?.trackTrace) {
        window.electronAPI.telemetry.trackTrace(message, severity, properties);
      } else {
        console.log('[Telemetry Trace]', message, severity, properties);
      }
    } catch (error) {
      console.error('Failed to track trace:', error);
    }
  }

  /**
   * Track a page view (useful for tracking different screens in the app)
   */
  trackPageView(name: string, properties?: { [key: string]: string }): void {
    this.trackEvent('PageView', { ...properties, pageName: name });
  }
}

export const clientTelemetry = new ClientTelemetry();
