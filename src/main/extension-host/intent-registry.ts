import { IntentContribution } from './extension-types';

export class IntentRegistry {
  private intents: Map<string, IntentContribution> = new Map();
  private intentOwners: Map<string, string> = new Map(); // intent -> extensionId

  /**
   * Registers intents from an extension manifest
   */
  public registerIntents(extensionId: string, contributions: IntentContribution[]) {
    for (const contribution of contributions) {
      if (this.intents.has(contribution.intent)) {
        console.warn(`[IntentRegistry] Duplicate intent '${contribution.intent}' registered by ${extensionId}. Overwriting previous registration.`);
      }
      
      this.intents.set(contribution.intent, contribution);
      this.intentOwners.set(contribution.intent, extensionId);
      console.log(`[IntentRegistry] Registered intent '${contribution.intent}' from ${extensionId}`);
    }
  }

  public unregisterIntents(extensionId: string) {
    const intentsToRemove: string[] = [];
    for (const [intent, owner] of this.intentOwners.entries()) {
      if (owner === extensionId) {
        intentsToRemove.push(intent);
      }
    }
    
    for (const intent of intentsToRemove) {
      this.intents.delete(intent);
      this.intentOwners.delete(intent);
      console.log(`[IntentRegistry] Unregistered intent '${intent}' from ${extensionId}`);
    }
  }

  public getIntent(intent: string): IntentContribution | undefined {
    return this.intents.get(intent);
  }

  public getExtensionForIntent(intent: string): string | undefined {
    return this.intentOwners.get(intent);
  }

  public getAllIntents(): IntentContribution[] {
    return Array.from(this.intents.values());
  }

  public clear() {
    this.intents.clear();
    this.intentOwners.clear();
  }
}
