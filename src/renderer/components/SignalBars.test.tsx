import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SignalBars from './SignalBars';

describe('SignalBars', () => {
  it('renders filled bars from RSSI', () => {
    const { container } = render(<SignalBars rssi={-55} />);
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(4);
    // -55 → level 4 → all filled green
    expect(rects[3].getAttribute('fill')).toBe('#4ade80');
  });

  it('uses explicit level override for IP RTT mapping', () => {
    const { container } = render(<SignalBars level={2} />);
    const rects = container.querySelectorAll('rect');
    expect(rects[0].getAttribute('fill')).toBe('#4ade80');
    expect(rects[1].getAttribute('fill')).toBe('#4ade80');
    expect(rects[2].getAttribute('fill')).toBe('#374151');
  });

  it('renders grey bars when noData', () => {
    const { container } = render(<SignalBars noData />);
    const rects = container.querySelectorAll('rect');
    for (const rect of rects) {
      expect(rect.getAttribute('fill')).toBe('#4b5563');
    }
  });

  it('treats null rssi as no data', () => {
    const { container } = render(<SignalBars rssi={null} />);
    const rects = container.querySelectorAll('rect');
    expect(rects[0].getAttribute('fill')).toBe('#4b5563');
  });
});
