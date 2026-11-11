import type { FederatedProvider } from '../models/bible';

/** Sanctum (or other account UI) reports linked cloud providers here for tour gates. */
let linkedProviders: Record<FederatedProvider, boolean> = {
  google: false,
  microsoft: false,
};

export function setLinkedCloudProviders(next: Record<FederatedProvider, boolean>): void {
  linkedProviders = {
    google: Boolean(next.google),
    microsoft: Boolean(next.microsoft),
  };
}

export function hasLinkedCloudProvider(): boolean {
  return linkedProviders.google || linkedProviders.microsoft;
}
