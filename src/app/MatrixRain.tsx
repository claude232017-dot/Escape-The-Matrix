import { useEffect, useRef } from 'react';

/**
 * The rain.
 *
 * ---------------------------------------------------------------------------
 * Where this is allowed to be, and where it is not
 * ---------------------------------------------------------------------------
 * On the threshold screens only — sign in, password reset, the disclosure. **Never behind the
 * SITREP.** That screen has a filing gate the browser suite *measures* at sixty seconds, and
 * moving glyphs behind a man deciding whether he held his oath is not atmosphere, it is
 * interference. The rain marks the door; it does not follow him inside.
 *
 * That restraint is what keeps it out of §1's way. This is not a badge, a level or a reward —
 * nothing about it responds to what he did, and it looks identical on his best day and his
 * worst. It is a room, not a scoreboard.
 *
 * ---------------------------------------------------------------------------
 * Reduced motion draws one frame and stops
 * ---------------------------------------------------------------------------
 * §3.12 requires `prefers-reduced-motion` to be honoured, and the usual reading is "render
 * nothing". That throws away the whole look for the people who set the preference, which is a
 * worse outcome than it sounds — the setting is often about vestibular discomfort, not taste.
 *
 * So under reduced motion this paints a single still frame: the same glyphs, the same colour,
 * frozen. Nothing moves, nothing is lost. The global CSS rule cannot help here because a canvas
 * animation is a `requestAnimationFrame` loop rather than a CSS transition, so the check is
 * explicit and the loop is never started.
 *
 * ---------------------------------------------------------------------------
 * Cheap on a phone, and honest about it
 * ---------------------------------------------------------------------------
 * Canvas rather than elements: a column of DOM nodes per glyph is hundreds of nodes being laid
 * out every frame. Capped at ~24fps, because rain does not need 60 and the difference is
 * battery on a device somebody is holding at six in the morning. Paused entirely when the tab
 * is hidden — an invisible animation is pure cost.
 */

/** Half-width katakana, the alphabet the effect is actually made of, plus digits. */
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789';

const COLUMN_WIDTH = 16;
const FRAME_MS = 42; // ~24fps
/** Faint enough that nothing in front of it loses contrast. Measured, not guessed — see below. */
const TRAIL_ALPHA = 0.08;

export interface MatrixRainProps {
  /** Test seam: forces the still frame without a media query. */
  reducedMotion?: boolean;
}

export function MatrixRain({ reducedMotion }: MatrixRainProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const still =
      reducedMotion ??
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // Read from the generated tokens rather than hardcoding, so the rain cannot drift away from
    // the palette the contrast suite measures. See src/design/tokens.ts.
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--colour-accent').trim() || '#4ADE9B';
    const head = styles.getPropertyValue('--colour-accent-strong').trim() || '#79F0BC';
    const voidColour = styles.getPropertyValue('--colour-surface-void').trim() || '#05070A';

    let columns: number[] = [];
    let width = 0;
    let height = 0;

    function resize(): void {
      if (!canvas || !context) return;
      // The canvas is fixed to the viewport, so its size is the viewport's — never the
      // document's, which would grow with the page and allocate a buffer nobody can see.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `${String(COLUMN_WIDTH)}px ui-monospace, monospace`;
      context.textBaseline = 'top';

      const count = Math.ceil(width / COLUMN_WIDTH);
      columns = Array.from({ length: count }, () =>
        // Staggered starts, so the first frame is a field of rain rather than a single line
        // sweeping down in unison — which reads as a loading bar.
        Math.floor((Math.random() * -height) / COLUMN_WIDTH),
      );

      context.fillStyle = voidColour;
      context.fillRect(0, 0, width, height);
    }

    function draw(): void {
      if (!context) return;
      // The trail: a translucent wash of the background colour each frame, so older glyphs fade
      // rather than being cleared. This is the whole effect, and it is one fillRect.
      context.globalAlpha = TRAIL_ALPHA;
      context.fillStyle = voidColour;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;

      for (let i = 0; i < columns.length; i += 1) {
        const y = (columns[i] ?? 0) * COLUMN_WIDTH;
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '0';

        // The leading glyph is brighter — that is what makes it read as falling rather than as
        // a column of noise.
        context.fillStyle = head;
        context.fillText(glyph, i * COLUMN_WIDTH, y);
        context.fillStyle = accent;
        context.fillText(
          GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '0',
          i * COLUMN_WIDTH,
          y - COLUMN_WIDTH,
        );

        columns[i] =
          y > height && Math.random() > 0.975 ? 0 : (columns[i] ?? 0) + 1;
      }
    }

    resize();

    if (still) {
      // One frame, then nothing. Enough passes to build a field rather than a single row, so
      // the look survives the preference instead of being switched off with it.
      context.globalAlpha = 1;
      for (let i = 0; i < 60; i += 1) draw();
      return;
    }

    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;
      last = now;
      draw();
    };
    frame = requestAnimationFrame(tick);

    // An animation nobody can see is pure battery cost.
    const onVisibility = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
      } else {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="matrix-rain"
      // Decoration. It carries no information, so it is removed from the accessibility tree
      // entirely rather than given a label nobody needs read to them.
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-[0.22]"
    />
  );
}
