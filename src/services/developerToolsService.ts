import { fetchDeveloperCapabilities } from './cloudControlService';

let remoteDeveloper = false;
let capabilitiesRequested = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isDeveloperToolsEnabled(): boolean {
  return isLocalDevelopment() || remoteDeveloper;
}

export function subscribeDeveloperTools(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function ensureDeveloperCapabilities(userId?: string | null): Promise<boolean> {
  if (isLocalDevelopment()) {
    return true;
  }
  if (capabilitiesRequested || process.env.NODE_ENV === 'test') {
    return remoteDeveloper;
  }
  capabilitiesRequested = true;
  try {
    const capabilities = await fetchDeveloperCapabilities(userId);
    remoteDeveloper = capabilities?.isDeveloper === true;
  } catch {
    remoteDeveloper = false;
  }
  emit();
  return remoteDeveloper;
}

export function __resetDeveloperToolsForTests(): void {
  remoteDeveloper = false;
  capabilitiesRequested = false;
  emit();
}
