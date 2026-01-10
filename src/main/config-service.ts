// src/main/config-service.ts
import Store from 'electron-store';
import { safeStorage } from 'electron';

interface AppConfig {
  youtube: {
    enabled: boolean;
    channelId?: string;
    autoConnect: boolean;
  };
  obs: {
    enabled: boolean;
    host?: string;
    password?: string;
  };
  iracing: {
    enabled: boolean;
  };
  // Future config sections can go here
}

// Schema for electron-store validation and defaults
const schema = {
  youtube: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      channelId: { type: 'string' },
      autoConnect: { type: 'boolean', default: false }
    },
    default: {}
  },
  obs: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      host: { type: 'string' },
      password: { type: 'string' }
    },
    default: {}
  },
  iracing: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true }
    },
    default: {}
  }
} as const;

class ConfigService {
  private store: Store<AppConfig>;

  constructor() {
    this.store = new Store<AppConfig>({ schema });
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  // Secure Storage Methods using Keytar/safeStorage abstraction
  // Note: Electron safeStorage is only available after app 'ready'
  async saveSecure(key: string, value: string): Promise<boolean> {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(value);
      this.store.set(`secure.${key}` as any, buffer.toString('base64'));
      return true;
    }
    console.warn('safeStorage not available - cannot save secure token');
    return false;
  }

  async getSecure(key: string): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    
    const encryptedBase64 = this.store.get(`secure.${key}` as any);
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return null;

    try {
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('Failed to decrypt secure value:', error);
      return null;
    }
  }

  async deleteSecure(key: string): Promise<void> {
    this.store.delete(`secure.${key}` as any);
  }
}

export const configService = new ConfigService();
