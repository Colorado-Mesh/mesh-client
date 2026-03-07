import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import ConfigPanel from './ConfigPanel';

describe('ConfigPanel accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <ConfigPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        onSetChannel={vi.fn().mockResolvedValue(undefined)}
        onClearChannel={vi.fn().mockResolvedValue(undefined)}
        channelConfigs={[]}
        isConnected={false}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
