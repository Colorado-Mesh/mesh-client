import { MotionIconConfig } from 'lucide-react-motion';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect, useSyncExternalStore } from 'react';

import {
  readReduceMotion,
  subscribeReduceMotion,
  syncReduceMotionDatasetFromStorage,
} from '@/renderer/lib/reduceMotionPreference';

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, readReduceMotion, () => false);
}

/** Default trigger for decorative icons (hover vs static). */
export function useIconTrigger(): 'hover' | 'parent-hover' | 'manual' {
  const reduceMotion = useReduceMotion();
  return reduceMotion ? 'manual' : 'hover';
}

/** Trigger for icons inside interactive controls (tabs, buttons). */
export function useParentIconTrigger(): 'parent-hover' | 'manual' {
  const reduceMotion = useReduceMotion();
  return reduceMotion ? 'manual' : 'parent-hover';
}

export function IconMotionProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const defaultTrigger = reduceMotion ? 'manual' : 'hover';
  const motionPref = reduceMotion ? 'always' : 'never';

  useEffect(() => {
    syncReduceMotionDatasetFromStorage();
  }, []);

  return (
    <MotionConfig reducedMotion={motionPref}>
      <MotionIconConfig
        duration={0.4}
        trigger={defaultTrigger}
        reducedMotion="never"
        stagger={0.08}
      >
        {children}
      </MotionIconConfig>
    </MotionConfig>
  );
}
