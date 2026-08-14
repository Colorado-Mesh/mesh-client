import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { HelpTooltip } from '@/renderer/components/HelpTooltip';
import { ReticulumTxBufferingHeaderIndicator } from '@/renderer/components/ReticulumTxBufferingHeaderIndicator';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { queueBadgeColorClass } from '@/renderer/lib/queueBadgeColors';

/**
 * Header cluster smoke for Reticulum Q badge + buffering (mirrors App.tsx wiring
 * without mounting full App / real useReticulumRuntime).
 */
function ReticulumQueueHeaderCluster({
  free,
  maxlen,
  interfaceName,
}: {
  free: number;
  maxlen: number;
  interfaceName: string;
}) {
  const used = maxlen - free;
  const color = queueBadgeColorClass(used, maxlen, 'ratio');
  return (
    <div>
      {used > 0 ? (
        <ReticulumTxBufferingHeaderIndicator buffering interfaceName={interfaceName} />
      ) : null}
      <HelpTooltip text={`Host TX queue for local RNode "${interfaceName}"`}>
        <div aria-label={`Q: ${used}/${maxlen}`} className={color}>
          {`Q: ${used}/${maxlen}`}
        </div>
      </HelpTooltip>
    </div>
  );
}

describe('Reticulum queue header cluster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Q badge without spinner when empty', async () => {
    const { container } = render(
      <ReticulumQueueHeaderCluster free={256} maxlen={256} interfaceName="RNode USB" />,
    );
    expect(screen.getByText('Q: 0/256')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows buffering spinner and Q badge when fill > 0', async () => {
    const { container } = render(
      <ReticulumQueueHeaderCluster free={192} maxlen={256} interfaceName="RNode 41F4" />,
    );
    expect(screen.getByText('Q: 64/256')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
