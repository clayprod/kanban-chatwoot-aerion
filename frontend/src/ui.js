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
  'inline-flex items-center justify-center gap-2 h-9 rounded-xl px-4 text-sm font-semibold ' +
  'bg-primary text-white shadow-card transition hover:bg-primary-strong ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 h-9 rounded-xl px-4 text-sm font-semibold ' +
  'border border-border bg-card text-ink transition hover:bg-cardAlt ' +
  'dark:bg-[#111827] dark:text-[#e5e7eb] dark:border-[#1f2937] dark:hover:bg-[#0f172a] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const btnGhost =
  'inline-flex items-center justify-center gap-2 h-9 rounded-xl px-3 text-sm font-semibold ' +
  'text-muted transition hover:bg-cardAlt hover:text-ink ' +
  'dark:text-[#94a3b8] dark:hover:bg-[#0f172a] dark:hover:text-[#e5e7eb] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

export const iconBtn =
  'inline-flex items-center justify-center h-9 w-9 rounded-xl text-muted transition ' +
  'hover:bg-cardAlt hover:text-ink ' +
  'dark:text-[#94a3b8] dark:hover:bg-[#0f172a] dark:hover:text-[#e5e7eb] ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// --- Form controls -----------------------------------------------------------

export const input =
  'h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink ' +
  'placeholder:text-muted transition ' +
  'dark:bg-[#0f172a] dark:text-[#e5e7eb] dark:border-[#1f2937] dark:placeholder:text-[#94a3b8] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const select =
  'h-9 rounded-xl border border-border bg-cardAlt px-3 text-sm text-ink transition ' +
  'dark:bg-[#0f172a] dark:text-[#e5e7eb] dark:border-[#1f2937] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

export const textarea =
  'rounded-xl border border-border bg-cardAlt px-3 py-2 text-sm text-ink ' +
  'placeholder:text-muted transition ' +
  'dark:bg-[#0f172a] dark:text-[#e5e7eb] dark:border-[#1f2937] dark:placeholder:text-[#94a3b8] ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:outline-none';

// --- Surfaces & typography ---------------------------------------------------

export const card =
  'rounded-2xl border border-border bg-card shadow-card ' +
  'dark:bg-[#111827] dark:border-[#1f2937]';

export const cardAlt =
  'rounded-2xl border border-border bg-cardAlt ' +
  'dark:bg-[#0f172a] dark:border-[#1f2937]';

export const sectionTitle =
  'text-sm font-semibold text-ink dark:text-[#e5e7eb]';

export const subtle =
  'text-xs text-muted dark:text-[#94a3b8]';

// --- Modals ------------------------------------------------------------------

export const modalOverlay =
  'fixed inset-0 z-modal bg-black/50 flex items-center justify-center p-4';

export const modalPanel =
  'w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-lift ' +
  'dark:bg-[#111827] dark:border-[#1f2937]';

// --- Badges & chips ----------------------------------------------------------

export const badge =
  'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ' +
  'bg-primary/10 text-primary';

export const chip =
  'inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full max-w-full truncate ' +
  'border border-border bg-cardAlt text-muted ' +
  'dark:bg-[#0f172a] dark:border-[#1f2937] dark:text-[#94a3b8]';
