import { MotionIconConfig } from 'lucide-react-motion';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import {
  initReduceMotionDefaultIfAbsent,
  readReduceMotion,
  subscribeReduceMotion,
  syncReduceMotionDatasetFromStorage,
} from '@/renderer/lib/reduceMotionPreference';

let initRan = false;

function ensureReduceMotionInit(): void {
  if (initRan) return;
  initRan = true;
  initReduceMotionDefaultIfAbsent();
  syncReduceMotionDatasetFromStorage();
}

export function useReduceMotion(): boolean {
  ensureReduceMotionInit();
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
  ensureReduceMotionInit();
  const reduceMotion = useReduceMotion();
  const defaultTrigger = reduceMotion ? 'manual' : 'hover';

  return (
    <MotionConfig reducedMotion="never">
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
