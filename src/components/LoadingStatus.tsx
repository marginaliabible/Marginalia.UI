import React from 'react';

interface LoadingStatusProps {
  isLoading: boolean;
  error: string | null;
}

const LoadingStatus: React.FC<LoadingStatusProps> = ({ isLoading, error }) => {
  if (!isLoading && !error) {
    return null;
  }

  return (
    <section className="mt-4">
      {isLoading && (
        <div
          className="alert alert-info d-inline-flex align-items-center gap-2 py-2 mb-0"
          role="status"
        >
          <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
          <span>Loading...</span>
        </div>
      )}
      {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
    </section>
  );
};

export default LoadingStatus;
