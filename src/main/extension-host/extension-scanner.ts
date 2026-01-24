import * as fs from 'fs';
import * as path from 'path';
import { ExtensionManifest } from './extension-types';

export interface ScannedExtension {
  id: string; // usually name from package.json
  path: string;
  manifest: ExtensionManifest;
}

export class ExtensionScanner {
  private extensionsPath: string;

  constructor(extensionsPath: string) {
    this.extensionsPath = extensionsPath;
  }

  public async scan(): Promise<ScannedExtension[]> {
    if (!fs.existsSync(this.extensionsPath)) {
      console.warn(`[ExtensionScanner] Extensions path not found: ${this.extensionsPath}`);
      return [];
    }

    const entries = await fs.promises.readdir(this.extensionsPath, { withFileTypes: true });
    const extensions: ScannedExtension[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(this.extensionsPath, entry.name);
        try {
          const manifest = await this.readManifest(fullPath);
          if (manifest) {
            extensions.push({
              id: manifest.name,
              path: fullPath,
              manifest: manifest
            });
            console.log(`[ExtensionScanner] Found extension: ${manifest.name} at ${fullPath}`);
          }
        } catch (error) {
          console.error(`[ExtensionScanner] Failed to load extension at ${fullPath}:`, error);
        }
      }
    }

    return extensions;
  }

  private async readManifest(extensionDir: string): Promise<ExtensionManifest | null> {
    const manifestPath = path.join(extensionDir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const content = await fs.promises.readFile(manifestPath, 'utf-8');
    try {
      const manifest = JSON.parse(content) as ExtensionManifest;
      // Basic validation
      if (!manifest.name || !manifest.version || !manifest.main) {
        console.warn(`[ExtensionScanner] Invalid manifest at ${manifestPath}: missing name, version, or main.`);
        return null;
      }
      return manifest;
    } catch (e) {
      console.error(`[ExtensionScanner] Failed to parse manifest at ${manifestPath}`);
      return null;
    }
  }
}
