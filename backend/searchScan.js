'use strict';

// Head pages catch new publications; the persisted tail cursor revisits older
// pages. Failure never advances the cursor past an unprocessed page.
async function scanSearchTerm({ state = {}, fetchPage, processPage, pageSize = 50, headPages = 2, tailPages = 4 }) {
  const next = { ...state, complete: false, errors: [], pages_this_run: [], updated_at: new Date().toISOString() };
  let cursor = Math.max(headPages + 1, Number(state.next_page) || headPages + 1);
  const pages = [...Array.from({ length: headPages }, (_, i) => i + 1),
    ...Array.from({ length: tailPages }, (_, i) => cursor + i)];
  let exhausted = false;
  for (const page of pages) {
    try {
      const data = await fetchPage(page);
      const items = data.items || [];
      if (page === 1 && items.length) next.observed_page_size = items.length;
      const observedSize = next.observed_page_size || pageSize;
      const reported = Number(data.total) || 0;
      if (!items.length && reported > (page - 1) * observedSize) throw new Error('Página vazia antes do total informado pelo PNCP; continuidade preservada.');
      await processPage(items, page);
      next.pages_this_run.push(page);
      next.candidates = (Number(next.candidates) || 0) + items.length;
      next.total_reported = Number(data.total) || next.total_reported || 0;
      if (page > headPages) cursor = page + 1;
      const totalPages = next.total_reported > 0 ? Math.ceil(next.total_reported / observedSize) : null;
      if (items.length < observedSize || (totalPages && page >= totalPages)) {
        // A full cycle is only proven after traversing the persisted tail.
        exhausted = true;
        next.last_cycle_completed_at = new Date().toISOString();
        cursor = headPages + 1;
        break;
      }
    } catch (error) {
      next.errors.push({ page, message: error.message });
      if (page > headPages) cursor = page;
      break;
    }
  }
  next.next_page = cursor;
  next.complete = exhausted && !next.errors.length;
  next.coverage_kind = next.complete ? 'cycle_completed' : 'partial_rotating';
  return next;
}

module.exports = { scanSearchTerm };
