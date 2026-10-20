import { useState } from 'react';
import type { SyncStoragePlan } from '../utils/syncStoragePlans';
import { formatPlanPriceLabel } from '../utils/syncStoragePlans';

export type PaymentSimResult = 'completed' | 'failed';

interface SyncPlanPaymentSimModalProps {
  plan: SyncStoragePlan;
  onConfirm: (result: PaymentSimResult) => void;
  onCancel: () => void;
}

const SyncPlanPaymentSimModal: React.FC<SyncPlanPaymentSimModalProps> = ({
  plan,
  onConfirm,
  onCancel,
}) => {
  const [result, setResult] = useState<PaymentSimResult>('completed');
  const price = formatPlanPriceLabel(plan);

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1060 }} onClick={onCancel} />
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        aria-modal="true"
        role="dialog"
        aria-labelledby="sync-plan-payment-sim-title"
        style={{ zIndex: 1070 }}
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow">
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0" id="sync-plan-payment-sim-title">
                Upgrade to {plan.label}
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onCancel} />
            </div>
            <div className="modal-body">
              <p className="mb-3">You would have been charged {price}!</p>
              <div className="d-flex flex-column gap-2" role="radiogroup" aria-label="Payment simulation">
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="payment-sim"
                    checked={result === 'completed'}
                    onChange={() => setResult('completed')}
                  />
                  <span className="form-check-label">Simulate completed payment for upgrade</span>
                </label>
                <label className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="payment-sim"
                    checked={result === 'failed'}
                    onChange={() => setResult('failed')}
                  />
                  <span className="form-check-label">Simulate failed payment</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onConfirm(result)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SyncPlanPaymentSimModal;
