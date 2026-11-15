/** Our own palette (clean-room review: palette tokens, not the reference product's colours). */
export const THEME = {
  bg: '#0e1117',
  panel: '#151a23',
  panelHover: '#1d2430',
  border: '#232a36',
  borderHover: 'rgba(120, 140, 170, 0.35)',
  grid: '#171c25',
  text: '#c3cad6',
  textDim: '#7d8796',
  muted: '#5d6878',
  up: '#2bb673',
  down: '#e5484d',
  upAlpha: 'rgba(43, 182, 115, 0.45)',
  downAlpha: 'rgba(229, 72, 77, 0.45)',
  accent1: '#4c8dff',
  accent2: '#f5a524',
  accent3: '#b78cff',
  accent4: '#2dd4bf',
  accent5: '#ff7ab6',
  accent6: '#a3e635',
} as const;

/** Rotating colours for additional instances of the same indicator. */
export const ACCENTS = [THEME.accent1, THEME.accent2, THEME.accent3, THEME.accent4, THEME.accent5, THEME.accent6];
