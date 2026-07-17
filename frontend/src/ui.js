/**
 * ui.js — canonical className strings for the shared design system.
 *
 * Usage:
 *   import { btnPrimary, btnSecondarySm, input, card } from './ui';
 *   <button className={btnPrimary}>Salvar</button>
 *   <button className={`${btnGhost} w-full`}>...</button>   // compose with extra utilities
 *
 * Every constant already bakes in `dark:` variants, so dark mode is automatic
 * wherever these classes are used (the app toggles `.theme-dark` on <body>,
 * which Tailwind's selector strategy maps to the `dark:` variant — see
 * tailwind.config.js). Dark shades mirror the legacy App.css palette:
 *   surface #0b0f1a · card #111827 · cardAlt #0f172a · border #1f2937
 *   text #e5e7eb · muted #94a3b8
 *
 * These are presentational strings only — standardize, don't redesign.
 *
 * Sizing contract (do NOT append h-7/h-8/h-9 on top of these — Tailwind
 * conflict resolution is source-order, so overrides are unreliable):
 *   default / Md  h-9  text-sm   rounded-[11px]  — forms, primary actions
 *   Sm            h-8  text-xs   rounded-[11px]  — toolbars, filters, lists
 *   Xs            h-7  text-[11px] rounded-lg    — dense card footers
 *   Lg            h-10 text-sm   rounded-[11px]  — modal/footer CTAs
 *   Control       h-[42px]                     — matches search toolbars
 *
 * Form controls use text-base on small viewports (≥16px) so iOS Safari does
 * not auto-zoom on focus. App.css also enforces this globally for overrides.
 */

// --- Shared button primitives ------------------------------------------------

const btnLayout =
  'inline-flex items-center justify-center gap-2 font-semibold transition';

const btnFocus =
  'focus:outline-none focus:ring-2 focus:ring-primary/30';

const btnDisabled =
  'disabled:opacity-50 disabled:pointer-events-none';

const btnSizeMd = 'h-9 rounded-[11px] px-4 text-sm';
const btnSizeSm = 'h-8 rounded-[11px] px-3 text-xs';
const btnSizeXs = 'h-7 rounded-lg px-2.5 text-[11px]';
const btnSizeLg = 'h-10 rounded-[11px] px-5 text-sm';
const btnSizeControl = 'h-[42px] rounded-[11px] px-5 text-sm';

const btnPrimaryTone =
  'bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] text-white shadow-[0_6px_16px_rgba(124,92,255,.4)] hover:brightness-110';

const btnSecondaryTone =
  'border border-line bg-surf text-ink hover:bg-surf2 ' +
  'dark:bg-[#141a28] dark:text-[#eef1f8] dark:border-[#232c40] dark:hover:bg-[#1a2233]';

const btnGhostTone =
  'text-muted hover:bg-surf2 hover:text-ink ' +
  'dark:text-[#8b95ad] dark:hover:bg-[#1a2233] dark:hover:text-[#eef1f8]';

const btnDangerGhostTone =
  'border border-line bg-bg2 text-muted hover:border-status-danger/40 hover:text-status-danger ' +
  'dark:bg-[#0e1220] dark:border-[#232c40]';

// --- Buttons (default = Md / h-9) --------------------------------------------

export const btnPrimary =
  `${btnLayout} ${btnSizeMd} ${btnPrimaryTone} ${btnFocus} ${btnDisabled}`;

export const btnPrimarySm =
  `${btnLayout} ${btnSizeSm} ${btnPrimaryTone} ${btnFocus} ${btnDisabled}`;

export const btnPrimaryXs =
  `${btnLayout} ${btnSizeXs} ${btnPrimaryTone} ${btnFocus} ${btnDisabled}`;

export const btnPrimaryLg =
  `${btnLayout} ${btnSizeLg} ${btnPrimaryTone} ${btnFocus} ${btnDisabled}`;

/** Matches h-[42px] search toolbars (PCA / PNCP). */
export const btnPrimaryControl =
  `${btnLayout} ${btnSizeControl} ${btnPrimaryTone} ${btnFocus} ${btnDisabled}`;

export const btnSecondary =
  `${btnLayout} ${btnSizeMd} ${btnSecondaryTone} ${btnFocus} ${btnDisabled}`;

export const btnSecondarySm =
  `${btnLayout} ${btnSizeSm} ${btnSecondaryTone} ${btnFocus} ${btnDisabled}`;

export const btnSecondaryXs =
  `${btnLayout} ${btnSizeXs} ${btnSecondaryTone} ${btnFocus} ${btnDisabled}`;

export const btnSecondaryLg =
  `${btnLayout} ${btnSizeLg} ${btnSecondaryTone} ${btnFocus} ${btnDisabled}`;

/** Matches h-[42px] search toolbars (PCA / PNCP). */
export const btnSecondaryControl =
  `${btnLayout} h-[42px] rounded-[11px] px-3 text-xs ${btnSecondaryTone} ${btnFocus} ${btnDisabled}`;

export const btnGhost =
  `${btnLayout} ${btnSizeMd} px-3 ${btnGhostTone} ${btnFocus} ${btnDisabled}`;

export const btnGhostSm =
  `${btnLayout} ${btnSizeSm} px-2.5 ${btnGhostTone} ${btnFocus} ${btnDisabled}`;

export const btnGhostXs =
  `${btnLayout} ${btnSizeXs} px-2 ${btnGhostTone} ${btnFocus} ${btnDisabled}`;

/** Destructive / remove action for dense card footers. */
export const btnDangerGhost =
  `${btnLayout} ${btnSizeXs} ${btnDangerGhostTone} ${btnFocus} ${btnDisabled}`;

export const iconBtn =
  'inline-flex items-center justify-center h-9 w-9 rounded-full text-muted transition ' +
  'border border-transparent hover:border-line hover:bg-surf2 hover:text-ink ' +
  'dark:text-[#8b95ad] dark:hover:bg-[#1a2233] dark:hover:text-[#eef1f8] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// --- Form controls -----------------------------------------------------------

export const input =
  'h-9 min-w-0 max-w-full rounded-[11px] border border-line bg-bg2 px-3 text-base sm:text-sm text-ink ' +
  'placeholder:text-muted transition ' +
  'dark:bg-[#0e1220] dark:text-[#eef1f8] dark:border-[#232c40] dark:placeholder:text-[#8b95ad] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const select =
  'h-9 min-w-0 max-w-full rounded-[11px] border border-line bg-bg2 pl-3 pr-8 text-base sm:text-sm text-ink transition ' +
  'dark:bg-[#0e1220] dark:text-[#eef1f8] dark:border-[#232c40] ' +
  'hover:border-line2 focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const textarea =
  'rounded-[11px] border border-line bg-bg2 px-3 py-2 text-base sm:text-sm text-ink ' +
  'placeholder:text-muted transition ' +
  'dark:bg-[#0e1220] dark:text-[#eef1f8] dark:border-[#232c40] dark:placeholder:text-[#8b95ad] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

// --- Surfaces & typography ---------------------------------------------------

export const card =
  'rounded-[16px] border border-line bg-surf shadow-card ' +
  'dark:bg-[#141a28] dark:border-[#232c40]';

export const cardAlt =
  'rounded-[14px] border border-line bg-bg2 ' +
  'dark:bg-[#0e1220] dark:border-[#232c40]';

/** Nested entity card inside a section surface — equal-height grid friendly. */
export const entityCard =
  'flex h-full min-h-0 flex-col rounded-[14px] border border-line bg-bg2 p-3.5 ' +
  'dark:bg-[#0e1220] dark:border-[#232c40]';

/** Sticky action row at the bottom of entity cards. */
export const cardActionBar =
  'mt-auto flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2.5';

export const sectionTitle =
  'font-display text-sm font-semibold text-ink dark:text-[#eef1f8]';

export const subtle =
  'text-xs text-muted dark:text-[#8b95ad]';

// --- Modals ------------------------------------------------------------------

export const modalOverlay =
  'fixed inset-0 z-modal bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4';

export const modalPanel =
  'w-full max-w-lg max-h-[min(92dvh,100%)] overflow-y-auto rounded-t-[16px] sm:rounded-[16px] border border-border bg-card ' +
  'p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 sm:pb-5 shadow-lift ' +
  'dark:bg-[#111827] dark:border-[#1f2937]';

// --- Badges & chips ----------------------------------------------------------

export const badge =
  'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ' +
  'bg-primary/10 text-primary';

export const chip =
  'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg max-w-full truncate ' +
  'border border-line bg-bg2 text-muted ' +
  'dark:bg-[#0e1220] dark:border-[#232c40] dark:text-[#8b95ad]';

/** Dense meta pill (IA, WhatsApp status, filter bits). */
export const metaChip =
  'inline-flex items-center rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-[10px] text-muted ' +
  'dark:bg-[#0e1220] dark:border-[#232c40]';

/** Positive keyword chip. */
export const termChip =
  'inline-flex max-w-[9rem] items-center truncate rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-primary';

/** Negative keyword chip. */
export const termChipNeg =
  'inline-flex max-w-[9rem] items-center truncate rounded-md border border-amber/30 bg-amber/15 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wide text-amber';

/** Active / inactive status pill. */
export const statusPillActive =
  'inline-flex shrink-0 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600';

export const statusPillInactive =
  'inline-flex shrink-0 items-center rounded-full border border-line bg-bg2 px-2 py-0.5 text-[10px] font-semibold text-muted';
