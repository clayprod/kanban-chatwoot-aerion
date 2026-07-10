/**
 * ui.js — canonical className strings for the shared design system.
 *
 * Usage:
 *   import { btnPrimary, input, card } from './ui';
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
 * These are presentational strings only — standardize, don't redesign. Base
 * sizing: controls are `h-9` and `rounded-xl`; icon buttons are `h-9 w-9`.
 */

// --- Buttons -----------------------------------------------------------------

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 h-9 rounded-[11px] px-4 text-sm font-semibold ' +
  'bg-[linear-gradient(135deg,#7c5cff,#5a3ff0)] text-white shadow-[0_6px_16px_rgba(124,92,255,.4)] transition hover:brightness-110 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 h-9 rounded-[11px] px-4 text-sm font-semibold ' +
  'border border-line bg-surf text-ink transition hover:bg-surf2 ' +
  'dark:bg-[#141a28] dark:text-[#eef1f8] dark:border-[#232c40] dark:hover:bg-[#1a2233] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const btnGhost =
  'inline-flex items-center justify-center gap-2 h-9 rounded-[11px] px-3 text-sm font-semibold ' +
  'text-muted transition hover:bg-surf2 hover:text-ink ' +
  'dark:text-[#8b95ad] dark:hover:bg-[#1a2233] dark:hover:text-[#eef1f8] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const iconBtn =
  'inline-flex items-center justify-center h-9 w-9 rounded-[11px] text-muted transition ' +
  'hover:bg-surf2 hover:text-ink ' +
  'dark:text-[#8b95ad] dark:hover:bg-[#1a2233] dark:hover:text-[#eef1f8] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// --- Form controls -----------------------------------------------------------

export const input =
  'h-9 min-w-0 max-w-full rounded-[11px] border border-line bg-bg2 px-3 text-sm text-ink ' +
  'placeholder:text-muted transition ' +
  'dark:bg-[#0e1220] dark:text-[#eef1f8] dark:border-[#232c40] dark:placeholder:text-[#8b95ad] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const select =
  'h-9 min-w-0 max-w-full rounded-[11px] border border-line bg-bg2 px-3 text-sm text-ink transition ' +
  'dark:bg-[#0e1220] dark:text-[#eef1f8] dark:border-[#232c40] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const textarea =
  'rounded-[11px] border border-line bg-bg2 px-3 py-2 text-sm text-ink ' +
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

export const sectionTitle =
  'font-display text-sm font-semibold text-ink dark:text-[#eef1f8]';

export const subtle =
  'text-xs text-muted dark:text-[#8b95ad]';

// --- Modals ------------------------------------------------------------------

export const modalOverlay =
  'fixed inset-0 z-modal bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4';

export const modalPanel =
  'w-full max-w-lg max-h-[min(92dvh,100%)] overflow-y-auto rounded-t-[16px] sm:rounded-[16px] border border-border bg-card p-4 sm:p-5 shadow-lift ' +
  'dark:bg-[#111827] dark:border-[#1f2937]';

// --- Badges & chips ----------------------------------------------------------

export const badge =
  'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ' +
  'bg-primary/10 text-primary';

export const chip =
  'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg max-w-full truncate ' +
  'border border-line bg-bg2 text-muted ' +
  'dark:bg-[#0e1220] dark:border-[#232c40] dark:text-[#8b95ad]';
