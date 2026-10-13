import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

export function useWideMobileLayout(shellRef: RefObject<HTMLDivElement | null>): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const fontSize = Number.parseFloat(getComputedStyle(shell).fontSize) || 16;
      setWide(shell.clientWidth >= 48 * fontSize);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [shellRef]);

  return wide;
}
