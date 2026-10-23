import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
export default function PncpSearchDialog({ children, onClose }) {
  const ref = useRef(null);
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
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Nova busca de editais" onClick={e => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-line bg-surf p-4 shadow-xl outline-none sm:p-6">
      <div className="mb-4 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink">Fechar</button></div>{children}
    </div>
  </div>, document.body);
}
