import { ExtensionManifest } from './extension-types';

export interface ViewDefinition {
  id: string; // e.g. "my-extension.main-view"
  extensionId: string;
  name: string;
  type: 'panel' | 'dialog' | 'overlay';
  path?: string; // Relative path to HTML/component if applicable
}

export class ViewRegistry {
  private views: Map<string, ViewDefinition> = new Map();

  public register(extensionId: string, view: any) {
    const viewId = `${extensionId}.${view.id || 'default'}`;
    const def: ViewDefinition = {
      id: viewId,
      extensionId,
      name: view.name || viewId,
      type: view.type || 'panel',
      path: view.path
    };
    
    this.views.set(viewId, def);
    console.log(`[ViewRegistry] Registered view: ${viewId}`);
  }

  public get(viewId: string): ViewDefinition | undefined {
    return this.views.get(viewId);
  }

  public getAll(): ViewDefinition[] {
    return Array.from(this.views.values());
  }
}
