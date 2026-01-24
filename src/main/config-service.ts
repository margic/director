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
  discord: {
    enabled: boolean;
    channelId?: string;
  };
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
  },
  discord: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      channelId: { type: 'string' }
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

  getAny(key: string): any {
    return this.store.get(key);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  // Secure Storage Methods using Keytar/safeStorage abstraction
  // Note: Electron safeStorage is only available after app 'ready'
  async saveSecure(key: string, value: string): Promise<boolean> {
    const storageKey = `secure.${key}` as any;
    
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = safeStorage.encryptString(value);
        this.store.set(storageKey, 'enc:' + buffer.toString('base64'));
        return true;
      } catch (error) {
        console.error('safeStorage encryption failed:', error);
      }
    }
    
    // Fallback: Store securely if possible, otherwise plain text (Dev/Linux environment support)
    // We mark it as 'plain:' so we know it's not encrypted
    console.warn(`safeStorage unavailable or failed for ${key}. Falling back to plain text storage.`);
    this.store.set(storageKey, 'plain:' + value);
    return true;
  }

  async getSecure(key: string): Promise<string | null> {
    const storageKey = `secure.${key}` as any;
    const storedValue = this.store.get(storageKey) as string | undefined;
    
    if (!storedValue || typeof storedValue !== 'string') return null;

    if (storedValue.startsWith('plain:')) {
      return storedValue.substring(6);
    }

    if (storedValue.startsWith('enc:')) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn(`Captured encrypted value for ${key} but safeStorage is now unavailable.`);
        return null;
      }
      try {
        const buffer = Buffer.from(storedValue.substring(4), 'base64');
        return safeStorage.decryptString(buffer);
      } catch (error) {
        console.error('Failed to decrypt secure value:', error);
        return null;
      }
    }

    // Backward compatibility or direct base64 storage attempt from previous version
    if (safeStorage.isEncryptionAvailable()) {
       try {
        const buffer = Buffer.from(storedValue, 'base64');
        return safeStorage.decryptString(buffer);
      } catch {
        // failed legacy decrypt, assume invalid
        return null;
      }
    }

    return null;
  }

  async deleteSecure(key: string): Promise<void> {
    this.store.delete(`secure.${key}` as any);
  }

  isSecureSet(key: string): boolean {
    const encryptedBase64 = this.store.get(`secure.${key}` as any);
    return !!encryptedBase64;
  }
}

export const configService = new ConfigService();
