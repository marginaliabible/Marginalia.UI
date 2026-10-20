import { fireEvent, render, screen, within } from '@testing-library/react';
import SyncPlanUsageBar from './SyncPlanUsageBar';
import { PLAN_GIB, requiredPlanForBytes } from '../utils/syncStoragePlans';

describe('SyncPlanUsageBar', () => {
  it('defaults to Free radios and FREE price with no usage', () => {
    const onSelectedPlanChange = jest.fn();
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={0}
        providersWithSelection={[]}
        selectedPlan={requiredPlanForBytes(0)}
        onSelectedPlanChange={onSelectedPlanChange}
      />
    );

    expect(screen.getByText('FREE')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Free' })).toBeChecked();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('auto-selects Pro when billable usage exceeds 1GB and shows the upgrade warning', () => {
    const onSelectedPlanChange = jest.fn();
    const required = requiredPlanForBytes(2 * PLAN_GIB);
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google']}
        selectedPlan={requiredPlanForBytes(0)}
        onSelectedPlanChange={onSelectedPlanChange}
      />
    );

    expect(onSelectedPlanChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'Pro' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Google Drive/);
    expect(screen.getByRole('radio', { name: 'Free' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /^Pro \$10\.99$/ }));
  });

  it('shows paid price parts for a selected Pro plan', () => {
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google', 'microsoft']}
        selectedPlan={requiredPlanForBytes(2 * PLAN_GIB)}
        onSelectedPlanChange={jest.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: /^Pro \$10\.99$/ })).toBeChecked();
    expect(screen.getByText('$10')).toBeInTheDocument();
    expect(screen.getByText('.99 +tax')).toBeInTheDocument();
    expect(screen.getByText('per year')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Google Drive and OneDrive/);
  });

  it('shows a usage key only for displayed segments', () => {
    render(
      <SyncPlanUsageBar
        committedBytes={0.5 * PLAN_GIB}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google']}
        selectedPlan={requiredPlanForBytes(2.5 * PLAN_GIB)}
        onSelectedPlanChange={jest.fn()}
      />
    );

    const key = screen.getByRole('list', { name: 'Usage key' });
    expect(key).toHaveTextContent(/Committed Processing \(512 MB\)/);
    expect(key).toHaveTextContent(/Selected files \(512 MB\)/);
    expect(key).toHaveTextContent(/Over plan \(1\.5 GB\)/);
    expect(within(key).getByTitle('Data for which processing was already completed')).toBeInTheDocument();
    expect(within(key).getByTitle("Files you've selected covered by your current plan")).toBeInTheDocument();
    expect(within(key).getByTitle('Selected or Committed data not covered by your current plan')).toBeInTheDocument();
  });

  it('omits usage-key entries for segments that are not displayed', () => {
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google']}
        selectedPlan={requiredPlanForBytes(2 * PLAN_GIB)}
        onSelectedPlanChange={jest.fn()}
      />
    );

    const key = screen.getByRole('list', { name: 'Usage key' });
    expect(key).not.toHaveTextContent(/Committed Processing/);
    expect(key).toHaveTextContent(/Selected files/);
    expect(key).toHaveTextContent(/Over plan/);
  });

  it('renders the upgrade warning above the progress bar row', () => {
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google']}
        selectedPlan={requiredPlanForBytes(2 * PLAN_GIB)}
        onSelectedPlanChange={jest.fn()}
      />
    );

    const warning = screen.getByRole('status');
    const progress = screen.getByRole('progressbar');
    expect(warning.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses and expands the upgrade warning via accessible controls', () => {
    render(
      <SyncPlanUsageBar
        committedBytes={0}
        selectedBytes={2 * PLAN_GIB}
        providersWithSelection={['google']}
        selectedPlan={requiredPlanForBytes(2 * PLAN_GIB)}
        onSelectedPlanChange={jest.fn()}
      />
    );

    const warning = screen.getByRole('status');
    expect(warning).not.toHaveClass('is-collapsed');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse warning' }));
    expect(warning).toHaveClass('is-collapsed');
    expect(screen.getByRole('button', { name: 'Expand warning' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(warning);
    expect(warning).not.toHaveClass('is-collapsed');
    expect(screen.getByRole('button', { name: 'Collapse warning' })).toHaveAttribute('aria-expanded', 'true');
  });
});
