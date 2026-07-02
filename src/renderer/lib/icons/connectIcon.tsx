import { motion, useAnimation } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { useCallback, useEffect } from 'react';

import { useReduceMotion } from '@/renderer/lib/icons/iconMotionContext';

interface ConnectIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  /** When true, holds the plug/socket connect pose (e.g. header while connecting). */
  animated?: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 500, damping: 30 };

export function ConnectIcon({
  onMouseEnter,
  onMouseLeave,
  className,
  size = 28,
  animated = false,
  ...props
}: ConnectIconProps) {
  const controls = useAnimation();
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (animated && !reduceMotion) {
      void controls.start('animate');
    } else {
      void controls.start('normal');
    }
  }, [animated, reduceMotion, controls]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!animated && !reduceMotion) {
        void controls.start('animate');
      }
      onMouseEnter?.(e);
    },
    [animated, reduceMotion, controls, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!animated && !reduceMotion) {
        void controls.start('normal');
      }
      onMouseLeave?.(e);
    },
    [animated, reduceMotion, controls, onMouseLeave],
  );

  return (
    <div
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <motion.path
          animate={controls}
          initial="normal"
          d="M19 5l3 -3"
          transition={SPRING}
          variants={{
            normal: { d: 'M19 5l3 -3' },
            animate: { d: 'M17 7l5 -5' },
          }}
        />
        <motion.path
          animate={controls}
          initial="normal"
          d="m2 22 3-3"
          transition={SPRING}
          variants={{
            normal: { d: 'm2 22 3-3' },
            animate: { d: 'm2 22 6-6' },
          }}
        />
        <motion.path
          animate={controls}
          initial="normal"
          d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"
          transition={SPRING}
          variants={{
            normal: { x: 0, y: 0 },
            animate: { x: 3, y: -3 },
          }}
        />
        <motion.path
          animate={controls}
          initial="normal"
          d="M7.5 13.5 l2.5 -2.5"
          transition={SPRING}
          variants={{
            normal: { d: 'M7.5 13.5 l2.5 -2.5' },
            animate: { d: 'M10.43 10.57 l0.10 -0.10' },
          }}
        />
        <motion.path
          animate={controls}
          initial="normal"
          d="M10.5 16.5 l2.5 -2.5"
          transition={SPRING}
          variants={{
            normal: { d: 'M10.5 16.5 l2.5 -2.5' },
            animate: { d: 'M13.43 13.57 l0.10 -0.10' },
          }}
        />
        <motion.path
          animate={controls}
          initial="normal"
          d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"
          transition={SPRING}
          variants={{
            normal: { x: 0, y: 0 },
            animate: { x: -3, y: 3 },
          }}
        />
      </svg>
    </div>
  );
}
