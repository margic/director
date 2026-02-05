import { ExtensionManifest } from './extension-types';
import * as path from 'path';

export interface ViewDefinition {
  id: string; // e.g. "my-extension.main-view"
  extensionId: string;
  name: string;
  type: 'panel' | 'dialog' | 'overlay' | 'widget';
  path?: string; // Relative path to HTML/component if applicable
  width?: number;
  height?: number;
}

export class ViewRegistry {
  private views: Map<string, ViewDefinition> = new Map();

  public register(extensionId: string, extensionPath: string, view: any) {
    const viewId = `${extensionId}.${view.id || 'default'}`;
    const def: ViewDefinition = {
      id: viewId,
      extensionId,
      name: view.name || viewId,
      type: view.type || 'panel',
      path: view.path ? path.resolve(extensionPath, view.path) : undefined,
      width: view.width,
      height: view.height
    };
    
    this.views.set(viewId, def);
    
    // Log registration with appropriate message for React vs legacy HTML views
    if (def.path) {
      console.log(`[ViewRegistry] Registered view: ${viewId} at ${def.path}`);
    } else {
      console.log(`[ViewRegistry] Registered view: ${viewId} (React component)`);
    }
  }
  public unregisterViews(extensionId: string) {
    const idsToRemove: string[] = [];
    for (const [id, def] of this.views.entries()) {
      if (def.extensionId === extensionId) {
        idsToRemove.push(id);
      }
    }
    
    for (const id of idsToRemove) {
      this.views.delete(id);
      console.log(`[ViewRegistry] Unregistered view '${id}' from ${extensionId}`);
    }
  }
  public get(viewId: string): ViewDefinition | undefined {
    return this.views.get(viewId);
  }

  public getByType(type: 'panel' | 'dialog' | 'overlay' | 'widget'): ViewDefinition[] {
    const results: ViewDefinition[] = [];
    for (const view of this.views.values()) {
        if (view.type === type) {
            results.push(view);
        }
    }
    return results;
  }

  public getAll(): ViewDefinition[] {
      return Array.from(this.views.values());
  }
}
