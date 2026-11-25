/**
 * View-model for the optional Local Folders (Watchman) section of the File Sync picker.
 * The open-source build never passes it; the Sanctum overlay owns the data and behavior.
 */

import type { FolderSelectionTarget } from './folderSelection';

export interface LocalFolderEntry {
  /** Full path on the machine, as reported by the agent. */
  path: string;
  name: string;
  kind: 'file' | 'folder';
  /** Byte size for files when known; omitted for folders. */
  sizeBytes?: number;
}

export interface LocalFolderSizeChild {
  path: string;
  sizeBytes: number;
}

export interface LocalFolderSizeResult {
  sizeBytes: number;
  children: LocalFolderSizeChild[];
}

export interface LocalFolderSizeRequest {
  excluded?: readonly string[];
  included?: readonly string[];
}

export interface LocalFolderMachineView {
  machineId: string;
  name: string;
  online: boolean;
  /** Agent reported version is behind channel latest.json. */
  needsUpdate?: boolean;
  /** The agent is running in an interactive desktop session (required to open files). */
  interactiveSession?: boolean;
  hostname?: string;
  expanded: boolean;
  loading?: boolean;
  error?: string | null;
  /** True while waiting on the browser's Open Watchman protocol prompt. */
  grantPromptPending?: boolean;
  /** Directory listings keyed by parent path; `''` is the machine root. Undefined = not loaded. */
  entriesByPath: Record<string, LocalFolderEntry[] | undefined>;
  expandedPaths: string[];
  loadingPaths: string[];
  /** Staged Local Folders roots for this machine (absolute paths as ids). */
  selectedTargets: FolderSelectionTarget[];
}

export interface LocalFoldersBinding {
  machines: LocalFolderMachineView[];
  /** Opens the "connect a local folder" flow. */
  onConnect: () => void;
  /** Re-shows the browser protocol prompt while a grant wait is in progress. */
  onRetryGrantPrompt?: (machineId: string) => void;
  /** Aborts the in-flight grant wait and closes the prompt. */
  onCancelGrantPrompt?: (machineId: string) => void;
  /**
   * When false, hide the Local Folders "Connect" link (e.g. this browser already
   * paired an online Watchman on this machine). Defaults to true.
   */
  showConnect?: boolean;
  onExpandMachine: (machineId: string) => void;
  onExpandPath: (machineId: string, path: string) => void;
  onTogglePath: (machineId: string, path: string, kind: 'file' | 'folder') => void;
  /** Replace staged targets for a machine (right-pane tags/exclusions/remove). */
  onTargetsChange: (machineId: string, targets: FolderSelectionTarget[]) => void;
  /** List children for right-pane expand; also used when revealing a nested path. */
  listChildren: (machineId: string, path: string) => Promise<LocalFolderEntry[]>;
  /** One-shot recursive folder size from Watchman (aggregates only). */
  getFolderSize: (
    machineId: string,
    path: string,
    opts?: LocalFolderSizeRequest
  ) => Promise<LocalFolderSizeResult>;
  /** Rename / disconnect a machine. */
  onEditMachine: (machineId: string) => void;
  /** Machine to scroll to and highlight (e.g. from an unreachable-machine toast). */
  focusMachineId?: string | null;
  /** Absolute path row to scroll/highlight after Find in Account Sync (Local Folders). */
  focusPath?: string | null;
  focusRequestId?: number;
}
