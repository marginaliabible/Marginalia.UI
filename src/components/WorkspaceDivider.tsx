import React from 'react';

interface WorkspaceDividerProps {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  orientation?: 'vertical' | 'horizontal';
}

const WorkspaceDivider: React.FC<WorkspaceDividerProps> = ({
  onPointerDown,
  onKeyDown,
  orientation = 'vertical',
}) => {
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={`workspace-divider ${isVertical ? 'is-vertical' : 'is-horizontal'}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={isVertical ? 'Resize verse and panel columns' : 'Resize stacked panels'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
};

export default WorkspaceDivider;
