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
  buffering,
}: {
  free: number;
  maxlen: number;
  interfaceName: string;
  buffering: boolean;
}) {
  const used = maxlen - free;
  const color = queueBadgeColorClass(used, maxlen, 'ratio');
  return (
    <div>
      {buffering ? (
        <ReticulumTxBufferingHeaderIndicator buffering interfaceName={interfaceName} />
      ) : null}
      {buffering ? (
        <HelpTooltip text={`Host TX queue for local RNode "${interfaceName}"`}>
          <div aria-label={`Q: ${used}/${maxlen}`} className={color}>
            {`Q: ${used}/${maxlen}`}
          </div>
        </HelpTooltip>
      ) : null}
    </div>
  );
}

describe('Reticulum queue header cluster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows nothing when idle baseline fill is not buffering', async () => {
    const { container } = render(
      <ReticulumQueueHeaderCluster
        free={245}
        maxlen={256}
        interfaceName="RNode 41F4"
        buffering={false}
      />,
    );
    expect(screen.queryByText('Q: 11/256')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows buffering spinner and Q badge when host TX is actively buffering', async () => {
    const { container } = render(
      <ReticulumQueueHeaderCluster free={192} maxlen={256} interfaceName="RNode 41F4" buffering />,
    );
    expect(screen.getByText('Q: 64/256')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
