import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Motion, configured once for the whole app.
 *
 * `LazyMotion` + `domAnimation` keeps the animation bundle small; `strict` makes the
 * full-fat `motion.*` components throw at development time, so nobody can quietly pull
 * the whole library back in via an import.
 *
 * `reducedMotion="user"` is the library-side half of honouring the OS setting; the CSS
 * half lives in src/styles/global.css. Both are needed: this one covers animations the
 * library drives, that one covers everything else.
 */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
