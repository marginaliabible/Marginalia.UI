import { useEffect, useRef, useState } from 'react';
import type { LocalFolderEntry, LocalFolderMachineView, LocalFoldersBinding } from '../models/localFolders';
import WatchmanGrantPromptModal from './WatchmanGrantPromptModal';

function isUnderSelectedPath(path: string, selectedPaths: readonly string[]): boolean {
  return selectedPaths.some((selected) => (
    selected !== path && (path.startsWith(`${selected}/`) || path.startsWith(`${selected}\\`))
  ));
}

interface MachineTreeProps {
  machine: LocalFolderMachineView;
  parentPath: string;
  depth: number;
  binding: LocalFoldersBinding;
  pathRowRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  focusPath?: string | null;
}

const MachineTree: React.FC<MachineTreeProps> = ({
  machine,
  parentPath,
  depth,
  binding,
  pathRowRefs,
  focusPath,
}) => {
  const entries: LocalFolderEntry[] | undefined = machine.entriesByPath[parentPath];
  const selectedPaths = machine.selectedTargets.map((target) => target.id);

  if (!entries) {
    return null;
  }
  if (entries.length === 0) {
    return (
      <li>
        <div className="small text-body-secondary cloud-folder-tree-loading" style={{ paddingLeft: `${depth * 0.55}rem` }}>
          Empty folder
        </div>
      </li>
    );
  }

  return (
    <>
      {entries.map((entry) => {
        const isFolder = entry.kind === 'folder';
        const expanded = machine.expandedPaths.includes(entry.path);
        const loading = machine.loadingPaths.includes(entry.path);
        const directSelected = selectedPaths.includes(entry.path);
        const ancestorSelected = isUnderSelectedPath(entry.path, selectedPaths);
        const checked = directSelected || ancestorSelected;
        const disabled = ancestorSelected || !machine.online;
        const isFocused = focusPath === entry.path;

        return (
          <li key={entry.path}>
            <div
              ref={(node) => {
                pathRowRefs.current[`${machine.machineId}:${entry.path}`] = node;
              }}
              className={`cloud-folder-tree-row${isFocused ? ' is-service-highlighted' : ''}`}
              style={{ paddingLeft: `${depth * 0.55}rem` }}
            >
              {isFolder ? (
                <button
                  type="button"
                  className="cloud-folder-tree-chevron"
                  aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                  onClick={() => binding.onExpandPath(machine.machineId, entry.path)}
                >
                  <i className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                </button>
              ) : (
                <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
              )}
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => binding.onTogglePath(machine.machineId, entry.path, entry.kind)}
                aria-label={entry.path}
              />
              <div className="cloud-folder-tree-name-wrap">
                <button
                  type="button"
                  className="cloud-folder-tree-name"
                  disabled={disabled}
                  title={entry.path}
                  onClick={() => binding.onTogglePath(machine.machineId, entry.path, entry.kind)}
                >
                  {entry.name}
                </button>
              </div>
            </div>
            {loading && <div className="small text-body-secondary cloud-folder-tree-loading">Loading...</div>}
            {isFolder && expanded && (
              <ul className="cloud-folder-tree-list">
                <MachineTree
                  machine={machine}
                  parentPath={entry.path}
                  depth={depth + 1}
                  binding={binding}
                  pathRowRefs={pathRowRefs}
                  focusPath={focusPath}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
};

interface LocalFoldersSectionProps {
  binding: LocalFoldersBinding;
}

/** Local Folders (Watchman machines) list shown in the File Sync providers pane when Sanctum supplies one. */
const LocalFoldersSection: React.FC<LocalFoldersSectionProps> = ({ binding }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const machineRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pathRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { focusMachineId, focusPath, focusRequestId } = binding;

  useEffect(() => {
    if (!focusMachineId) {
      return;
    }
    setIsExpanded(true);
  }, [focusMachineId, focusRequestId]);

  useEffect(() => {
    if (!focusMachineId || !isExpanded) {
      return;
    }
    if (focusPath) {
      const key = `${focusMachineId}:${focusPath}`;
      pathRowRefs.current[key]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    machineRowRefs.current[focusMachineId]?.scrollIntoView?.({ block: 'nearest' });
  }, [focusMachineId, focusPath, focusRequestId, isExpanded]);

  const grantPromptMachine = binding.machines.find((machine) => machine.grantPromptPending) ?? null;

  return (
    <>
      <ul className="cloud-folder-tree-list" aria-label="Local Folders" data-help="account-sync-local-folders">
        <li>
          <div className="cloud-folder-tree-row no-checkbox" style={{ paddingLeft: 0 }}>
            <button
              type="button"
              className="cloud-folder-tree-chevron"
              aria-label={isExpanded ? 'Collapse Local Folders' : 'Expand Local Folders'}
              onClick={() => setIsExpanded((current) => !current)}
            >
              <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
            </button>
            <div className="cloud-folder-tree-name-wrap">
              <button
                type="button"
                className="cloud-folder-tree-name"
                onClick={() => setIsExpanded((current) => !current)}
              >
                Local Folders
              </button>
              {binding.showConnect !== false && (
                <button
                  type="button"
                  className="btn btn-link btn-sm cloud-folder-tree-connect-link"
                  aria-label="Connect a local folder"
                  data-help="account-sync-local-folders-connect"
                  onClick={binding.onConnect}
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        </li>
        {isExpanded && binding.machines.map((machine) => (
          <li key={machine.machineId}>
            <div
              ref={(entry) => {
                machineRowRefs.current[machine.machineId] = entry;
              }}
              className={`cloud-folder-tree-row no-checkbox${focusMachineId === machine.machineId && !focusPath ? ' is-service-highlighted' : ''}`}
              style={{ paddingLeft: '0.55rem' }}
            >
              <button
                type="button"
                className="cloud-folder-tree-chevron"
                aria-label={machine.expanded ? `Collapse ${machine.name}` : `Expand ${machine.name}`}
                onClick={() => binding.onExpandMachine(machine.machineId)}
              >
                <i className={`fa-solid ${machine.expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
              </button>
              <div className="cloud-folder-tree-name-wrap">
                <div className="cloud-folder-tree-name-primary">
                  <button
                    type="button"
                    className="cloud-folder-tree-name"
                    title={machine.hostname || machine.name}
                    onClick={() => binding.onExpandMachine(machine.machineId)}
                  >
                    {machine.name}
                  </button>
                  {!machine.online && (
                    <span className="cloud-folder-tree-offline" title="Offline">
                      <i className="fa-solid fa-radiation" aria-hidden="true"></i>
                      offline
                    </span>
                  )}
                  {machine.needsUpdate && (
                    <span className="cloud-folder-tree-update" title="Update available">
                      <i className="fa-solid fa-arrow-up" aria-hidden="true"></i>
                      update
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-link btn-sm cloud-folder-tree-connect-link"
                  aria-label={`Edit ${machine.name}`}
                  onClick={() => binding.onEditMachine(machine.machineId)}
                >
                  Edit
                </button>
              </div>
            </div>
            {machine.expanded && (
              <>
                {machine.loading && !machine.grantPromptPending && (
                  <div className="small text-body-secondary cloud-folder-tree-loading">Loading...</div>
                )}
                {machine.error && !machine.grantPromptPending && (
                  <div className="small text-danger cloud-folder-tree-loading">{machine.error}</div>
                )}
                <ul className="cloud-folder-tree-list">
                  <MachineTree
                    machine={machine}
                    parentPath=""
                    depth={1}
                    binding={binding}
                    pathRowRefs={pathRowRefs}
                    focusPath={focusMachineId === machine.machineId ? focusPath : null}
                  />
                </ul>
              </>
            )}
          </li>
        ))}
      </ul>
      {grantPromptMachine && (
        <WatchmanGrantPromptModal
          machineName={grantPromptMachine.name}
          onRetry={() => binding.onRetryGrantPrompt?.(grantPromptMachine.machineId)}
          onCancel={() => binding.onCancelGrantPrompt?.(grantPromptMachine.machineId)}
        />
      )}
    </>
  );
};

export default LocalFoldersSection;
