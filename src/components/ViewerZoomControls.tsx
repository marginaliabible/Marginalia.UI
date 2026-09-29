import React from 'react';
import { MAX_SCALE, MIN_SCALE } from '../utils/viewerZoom';

interface ViewerZoomControlsProps {
  scale: number;
  fitWidth: boolean;
  onZoomStep: (direction: -1 | 1) => void;
  onFitWidth: () => void;
}

const ViewerZoomControls: React.FC<ViewerZoomControlsProps> = ({ scale, fitWidth, onZoomStep, onFitWidth }) => {
  const percent = `${Math.round(scale * 100)}%`;
  const fitLabel = fitWidth ? `Fit to width (${percent})` : `${percent}, reset to fit width`;

  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="btn btn-outline-secondary"
        onClick={() => onZoomStep(-1)}
        title="zoom out"
        aria-label="zoom out"
        disabled={scale <= MIN_SCALE}
      >
        <i className="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        className="btn btn-outline-secondary"
        onClick={onFitWidth}
        title={fitLabel}
        aria-label={fitLabel}
        aria-pressed={fitWidth}
      >
        {fitWidth && <i className="fa-solid fa-arrows-left-right me-1" aria-hidden="true"></i>}
        {percent}
      </button>
      <button
        type="button"
        className="btn btn-outline-secondary"
        onClick={() => onZoomStep(1)}
        title="zoom in"
        aria-label="zoom in"
        disabled={scale >= MAX_SCALE}
      >
        <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
      </button>
    </div>
  );
};

export default ViewerZoomControls;
