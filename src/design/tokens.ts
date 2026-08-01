/**
 * The palette, as data.
 *
 * Single source of truth: `src/styles/tokens.css` is *generated* from this file by
 * `npm run tokens:build`, and a test fails if the committed CSS has drifted. Colours
 * therefore cannot be edited in the stylesheet where the contrast test would not see
 * them.
 *
 * Aesthetic: restrained military terminal. One dark surface ramp, one accent green,
 * and a status set that is deliberately not decorative — pass / MED pass / fail / the
 * reset are the only places colour carries meaning, so nothing else competes with them.
 *
 * Every colour listed here must appear in at least one entry of `CONTRAST_PAIRS`; a
 * token with no declared usage is a token nobody measured, and the test rejects it.
 */

export const COLOUR_TOKENS = {
  /* Surfaces, darkest to lightest. */
  'surface-void': '#05070A',
  'surface-base': '#0A0E13',
  'surface-raised': '#121820',
  'surface-overlay': '#1A222C',
  'surface-sunken': '#070A0E',

  /* Lines. `border-strong` carries control boundaries and is measured at 3:1 per WCAG
     1.4.11; `border-subtle` is a decorative rule only — see CONTRAST_PAIRS. */
  'border-subtle': '#2E3D52',
  'border-strong': '#64768B',

  /* Text ramp. */
  'text-primary': '#E8EDF2',
  'text-secondary': '#AFBECC',
  'text-muted': '#8A9AAB',

  /* The single accent. Used for the campaign day, the active protocol, the primary action. */
  accent: '#4ADE9B',
  'accent-strong': '#79F0BC',
  'accent-ink': '#04120B',

  /* Status. `med` is amber not red on purpose: a MED pass is a win, not a lesser fail. */
  'status-pass': '#4ADE9B',
  'status-med': '#F0B93B',
  'status-fail': '#FF7A6B',
  'status-treason': '#FF4D5E',
  'status-pending': '#8A9AAB',

  /* Focus ring. Must clear 3:1 against every surface it can land on. */
  focus: '#7DD3FC',
} as const;

export type ColourToken = keyof typeof COLOUR_TOKENS;

export interface ContrastPair {
  /** Foreground token. */
  fg: ColourToken;
  /** Background token it is placed on. */
  bg: ColourToken;
  /**
   * `text` → 4.5:1 (WCAG 1.4.3).
   * `large-text` and `non-text` → 3:1 (WCAG 1.4.3 large / 1.4.11 UI components).
   * `decorative` → 1.5:1, and permitted *only* for marks that carry no information:
   *   a rule between sections, a hairline on a card. The moment a line distinguishes a
   *   control or a state it is `non-text` and owes 3:1. Nothing may rely on a
   *   decorative token to be perceivable, which is why the threshold is a floor
   *   against invisibility rather than a legibility standard.
   */
  kind: 'text' | 'large-text' | 'non-text' | 'decorative';
  /** Where this combination actually appears, so a failure names a screen. */
  usage: string;
}

/**
 * Every foreground/background combination the UI is allowed to produce.
 *
 * Declared rather than derived: the cross product of all tokens would include
 * meaningless pairs (surface on surface) whose failure would say nothing. This list is
 * the design contract, and adding a combination to a component means adding it here
 * first — otherwise it is untested by construction.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text-primary', bg: 'surface-void', kind: 'text', usage: 'App background, headings' },
  { fg: 'text-primary', bg: 'surface-base', kind: 'text', usage: 'Body copy on the main surface' },
  { fg: 'text-primary', bg: 'surface-raised', kind: 'text', usage: 'Card and panel copy' },
  { fg: 'text-primary', bg: 'surface-overlay', kind: 'text', usage: 'Dialog and menu copy' },
  { fg: 'text-primary', bg: 'surface-sunken', kind: 'text', usage: 'Inset wells, code blocks' },

  { fg: 'text-secondary', bg: 'surface-void', kind: 'text', usage: 'Supporting copy' },
  { fg: 'text-secondary', bg: 'surface-base', kind: 'text', usage: 'Field labels, MED text' },
  { fg: 'text-secondary', bg: 'surface-raised', kind: 'text', usage: 'Card labels' },
  { fg: 'text-secondary', bg: 'surface-overlay', kind: 'text', usage: 'Dialog supporting copy' },
  { fg: 'text-secondary', bg: 'surface-sunken', kind: 'text', usage: 'Inset supporting copy' },

  { fg: 'text-muted', bg: 'surface-void', kind: 'text', usage: 'Timestamps, hints' },
  { fg: 'text-muted', bg: 'surface-base', kind: 'text', usage: 'Placeholder and helper text' },
  { fg: 'text-muted', bg: 'surface-raised', kind: 'text', usage: 'Card metadata' },
  { fg: 'text-muted', bg: 'surface-overlay', kind: 'text', usage: 'Dialog metadata' },
  { fg: 'text-muted', bg: 'surface-sunken', kind: 'text', usage: 'Inset metadata' },

  { fg: 'accent', bg: 'surface-void', kind: 'text', usage: 'Campaign day counter' },
  { fg: 'accent', bg: 'surface-base', kind: 'text', usage: 'Links, active protocol marker' },
  { fg: 'accent', bg: 'surface-raised', kind: 'text', usage: 'Card accents, streak figure' },
  { fg: 'accent', bg: 'surface-overlay', kind: 'text', usage: 'Dialog primary text' },
  { fg: 'accent-strong', bg: 'surface-base', kind: 'text', usage: 'Hover / focus state of accent text' },
  { fg: 'accent-ink', bg: 'accent', kind: 'text', usage: 'Label on the primary (filled) button' },
  // The SITREP's answer control fills the chosen option. The label then sits on the status
  // colour rather than on a surface, which is a different measurement from the status text
  // pairs below — and the one that decides whether he can read what he just chose.
  { fg: 'accent-ink', bg: 'status-pass', kind: 'text', usage: 'Label on the chosen "Done / Held" option' },
  { fg: 'accent-ink', bg: 'status-med', kind: 'text', usage: 'Label on the chosen MED option' },
  { fg: 'accent-ink', bg: 'status-fail', kind: 'text', usage: 'Label on the chosen "Missed / Broke it" option' },

  { fg: 'status-pass', bg: 'surface-base', kind: 'text', usage: 'Protocol passed' },
  { fg: 'status-pass', bg: 'surface-raised', kind: 'text', usage: 'Protocol passed, in a card' },
  { fg: 'status-med', bg: 'surface-base', kind: 'text', usage: 'Passed at MED — a win, marked amber' },
  { fg: 'status-med', bg: 'surface-raised', kind: 'text', usage: 'Passed at MED, in a card' },
  // The MED text sits in an inset well inside the protocol row. Declared `text` rather than
  // non-text although it is also the well's left rule: the heading is real text, and the
  // stricter of two applicable thresholds is the one to measure against.
  { fg: 'status-med', bg: 'surface-sunken', kind: 'text', usage: 'MED heading and rule, in the SITREP inset' },
  { fg: 'status-fail', bg: 'surface-base', kind: 'text', usage: 'Protocol failed (tactical)' },
  { fg: 'status-fail', bg: 'surface-raised', kind: 'text', usage: 'Protocol failed, in a card' },
  { fg: 'status-treason', bg: 'surface-base', kind: 'text', usage: 'Act of treason / reset notice' },
  { fg: 'status-treason', bg: 'surface-raised', kind: 'text', usage: 'Reset notice, in a card' },
  { fg: 'status-pending', bg: 'surface-base', kind: 'text', usage: 'Not yet reported' },
  { fg: 'status-pending', bg: 'surface-raised', kind: 'text', usage: 'Not yet reported, in a card' },

  // The SITREP's live verdict sits in an inset well: what today amounts to, stated before he
  // files it. All three outcomes share that surface, so all three are measured on it.
  { fg: 'status-pass', bg: 'surface-sunken', kind: 'text', usage: 'Complete day, in the verdict well' },
  { fg: 'status-fail', bg: 'surface-sunken', kind: 'text', usage: 'Tactical failure, in the verdict well' },
  { fg: 'status-treason', bg: 'surface-sunken', kind: 'text', usage: 'Reset, in the verdict well' },

  { fg: 'border-strong', bg: 'surface-base', kind: 'non-text', usage: 'Input and control outlines' },
  { fg: 'border-strong', bg: 'surface-raised', kind: 'non-text', usage: 'Control outlines in cards' },
  { fg: 'border-strong', bg: 'surface-overlay', kind: 'non-text', usage: 'Control outlines in dialogs' },
  { fg: 'border-subtle', bg: 'surface-void', kind: 'decorative', usage: 'Section rules — never a control boundary' },
  { fg: 'border-subtle', bg: 'surface-raised', kind: 'decorative', usage: 'Card hairlines — never a control boundary' },
  { fg: 'border-subtle', bg: 'surface-base', kind: 'decorative', usage: 'Protocol row hairlines — never a control boundary' },

  { fg: 'focus', bg: 'surface-void', kind: 'non-text', usage: 'Focus ring on the app background' },
  { fg: 'focus', bg: 'surface-base', kind: 'non-text', usage: 'Focus ring on the main surface' },
  { fg: 'focus', bg: 'surface-raised', kind: 'non-text', usage: 'Focus ring in cards' },
  { fg: 'focus', bg: 'surface-overlay', kind: 'non-text', usage: 'Focus ring in dialogs' },
];

/** Non-colour tokens. Kept here so the generated stylesheet has one origin. */
export const SCALE_TOKENS = {
  // 'Inter Variable' is the family name the self-hosted @font-face declares — see
  // src/styles/fonts.css, which is the only thing that makes this line true. It said 'Inter'
  // for nine phases with nothing behind it, and every screen quietly rendered in the system
  // face. If that file is ever removed, remove this entry with it rather than leaving the
  // stack naming a font nobody ships.
  'font-sans':
    "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  // Numerals are monospaced everywhere: campaign day, counts and money are meant to be
  // compared down a column, and proportional digits make that harder than it needs to be.
  'font-mono': "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  'radius-sm': '2px',
  'radius-md': '4px',
  'radius-lg': '8px',
  'space-unit': '4px',
  'ring-width': '2px',
  'duration-fast': '120ms',
  'duration-base': '200ms',
  'duration-slow': '320ms',
  'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const MINIMUM_RATIO: Record<ContrastPair['kind'], number> = {
  text: 4.5,
  'large-text': 3,
  'non-text': 3,
  decorative: 1.5,
};

/**
 * Tokens that may only ever be used decoratively.
 *
 * Listed explicitly so the test can assert they never appear in a `text` or `non-text`
 * pair. Without this, "decorative" would be an escape hatch: any pair that failed 3:1
 * could be relabelled until it passed, and the contrast suite would measure nothing.
 */
export const DECORATIVE_ONLY_TOKENS: readonly ColourToken[] = ['border-subtle'];
