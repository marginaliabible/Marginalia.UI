import React from 'react';

interface WorkspaceDividerProps {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

const WorkspaceDivider: React.FC<WorkspaceDividerProps> = ({ onPointerDown, onKeyDown }) => {
  return (
    <div
      className="workspace-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize verse and panel columns"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
};

export default WorkspaceDivider;
