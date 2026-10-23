import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
export default function PncpSearchDialog({ children, onClose, title = 'Nova busca de editais' }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const nodes = () => [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(n => n.getClientRects().length);
    ref.current.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const all = nodes(), first = all[0], last = all[all.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    const node = ref.current; node.addEventListener('keydown', key);
    return () => { node.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, [onClose]);
  return createPortal(<div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onClick={e => e.stopPropagation()} className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surf shadow-xl outline-none">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2><p id={descriptionId} className="mt-1 text-sm text-muted">Defina o que procura, revise os critérios e confira uma amostra.</p></div>
        <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-bg2 hover:text-ink focus-visible:ring-2 focus-visible:ring-primary">Fechar</button>
      </header>
      <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
    </div>
  </div>, document.body);
}
