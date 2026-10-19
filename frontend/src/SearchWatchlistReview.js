import React, { useState } from 'react';
import axios from 'axios';
import SearchGuide from './SearchGuide';

export default function SearchWatchlistReview({ source, row, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initial = row.search_profile || row.filtros?.search_profile || {
    description: row.nome, objective: row.nome, terms: row.palavras_chave || [], related_terms: [],
    excluded_terms: row.termos_negativos || [], match_mode: 'literal', item_kind: 'all',
  };
  return <div className="space-y-2">
    {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
    <SearchGuide source={source} initialProfile={initial} filters={row.filtros || {}}
      activating={busy} onCancel={onClose} onActivate={async profile => {
        setBusy(true); setError('');
        try {
          await axios.put('/api/licitacoes/' + (source === 'pca' ? 'pca' : 'editais') + '/watchlist/' + row.id, {
            palavras_chave: [...profile.terms, ...profile.related_terms], termos_negativos: profile.excluded_terms,
            usar_ia: false, search_profile: profile, filtros: { ...(row.filtros || {}), search_profile: profile },
            valor_minimo: row.valor_minimo, valor_maximo: row.valor_maximo,
          });
          await onSaved(); onClose();
        } catch (e) { setError(e.response?.data?.error || 'Não foi possível salvar os critérios.'); }
        finally { setBusy(false); }
      }} />
  </div>;
}
