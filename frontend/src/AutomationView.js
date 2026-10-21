import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ViewColumnsIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  btnSecondarySm,
  card,
  cardAlt,
  iconBtn,
  input,
  sectionTitle,
  subtle,
} from './ui';

// Painel de leitura da automação comercial: o que a IA mandou e o que ela moveu.
// Os dois workers rodam sozinhos em background, então sem esta tela a única forma
// de saber se estão vivos é consultar o banco — e já aconteceu de ficarem dias
// parados por env apagada num deploy sem ninguém perceber.

const fmtDataHora = (valor) => {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const horasDesde = (valor) => {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
};

const CORES_STATUS = {
  sent: 'text-status-success',
  applied: 'text-status-success',
  dry_run: 'text-status-warning',
  suggested: 'text-primary',
  skipped: 'text-muted',
  failed: 'text-status-danger',
};

const ROTULO_STATUS = {
  sent: 'enviado',
  applied: 'movido',
  dry_run: 'simulado',
  suggested: 'sugerido',
  skipped: 'pulado',
  failed: 'falhou',
};

function Pill({ status, children }) {
  return (
    <span className={`shrink-0 text-[11px] font-semibold ${CORES_STATUS[status] || 'text-muted2'}`}>
      {children ?? ROTULO_STATUS[status] ?? status}
    </span>
  );
}

function Contadores({ hoje }) {
  const entradas = Object.entries(hoje || {});
  if (!entradas.length) return <span className={subtle}>nada hoje</span>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] tabular-nums">
      {entradas.map(([status, n]) => (
        <span key={status} className={CORES_STATUS[status] || 'text-muted2'}>
          {n} <span className="text-muted2">{ROTULO_STATUS[status] || status}</span>
        </span>
      ))}
    </div>
  );
}

// Um worker em silêncio pode ser "não havia o que fazer" ou "está desligado e
// ninguém viu". A diferença importa, então a tela diz qual dos dois é.
function Saude({ config, ultimaAtividade }) {
  if (!config) return null;
  const horas = horasDesde(ultimaAtividade);
  if (!config.enabled) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] border border-status-danger/30 bg-status-danger/10 p-2.5 text-[12px] text-status-danger">
        <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Desligado.</strong> A variável de ambiente que liga este worker não está
          valendo — normalmente porque um deploy limpou as variáveis do serviço.
        </span>
      </div>
    );
  }
  if (config.dry_run) {
    return (
      <div className="rounded-[10px] border border-status-warning/30 bg-status-warning/10 p-2.5 text-[12px] text-status-warning">
        <strong>Modo sombra.</strong> A IA decide e registra tudo abaixo, mas não executa nada.
      </div>
    );
  }
  if (horas !== null && horas > 48) {
    return (
      <div className="rounded-[10px] border border-status-warning/30 bg-status-warning/10 p-2.5 text-[12px] text-status-warning">
        Ligado, mas sem atividade há {Math.floor(horas / 24)} dia(s). Pode ser fila vazia — ou
        algo travado.
      </div>
    );
  }
  return null;
}

function Painel({ titulo, icone: Icone, config, hoje, itens, linhas, carregando, erro, onReload }) {
  return (
    <section className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icone className="h-5 w-5 shrink-0 text-primary" />
          <h2 className={sectionTitle}>{titulo}</h2>
        </div>
        <button type="button" onClick={onReload} className={`${iconBtn} h-7 w-7`} title="Atualizar">
          <ArrowPathIcon className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-2 space-y-2">
        <Saude config={config} ultimaAtividade={itens?.[0]?.created_at} />
        <Contadores hoje={hoje} />
      </div>

      {erro && <p className="mt-3 text-[12px] text-status-danger">{erro}</p>}

      <ul className="mt-3 space-y-1.5">
        {!itens?.length && !carregando && (
          <li className={`${subtle} py-6 text-center`}>Nenhuma decisão registrada ainda.</li>
        )}
        {itens?.map((it) => (
          <li key={it.id} className={`${cardAlt} px-3 py-2`}>
            {linhas(it)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AutomationView() {
  const [followups, setFollowups] = useState(null);
  const [stages, setStages] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [f, s] = await Promise.all([
        axios.get('/api/ai-followups?limit=60').catch((e) => ({ error: e })),
        axios.get('/api/ai-stages?limit=60').catch((e) => ({ error: e })),
      ]);
      if (f.error && s.error) throw f.error;
      setFollowups(f.error ? null : f.data);
      setStages(s.error ? null : s.data);
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível carregar a atividade da automação.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrar = useCallback((lista) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista || [];
    return (lista || []).filter((it) => [
      it.contact_name, it.message, it.motivo, it.skip_reason, it.to_stage, it.from_stage,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [busca]);

  const itensFollowup = useMemo(() => filtrar(followups?.decisoes), [followups, filtrar]);
  const itensStage = useMemo(() => filtrar(stages?.decisoes), [stages, filtrar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`${sectionTitle} text-lg`}>Automação</h1>
          <p className={`${subtle} mt-0.5`}>
            O que a IA fez sozinha: follow-ups enviados e etapas de funil corrigidas.
          </p>
        </div>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por contato, mensagem ou motivo…"
          className={`${input} h-9 w-full text-sm sm:w-80`}
          aria-label="Filtrar atividade da automação"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Painel
          titulo="Follow-up automático"
          icone={ChatBubbleLeftRightIcon}
          config={followups?.config}
          hoje={followups?.hoje}
          itens={itensFollowup}
          carregando={carregando}
          erro={!followups && !carregando ? 'Endpoint de follow-up indisponível.' : ''}
          onReload={carregar}
          linhas={(it) => (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                  {it.contact_name || `Contato #${it.contact_id}`}
                </span>
                <Pill status={it.status} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted2">
                {fmtDataHora(it.created_at)}
                {it.confidence != null && ` · confiança ${Number(it.confidence).toFixed(2)}`}
              </p>
              {it.message && (
                <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">{it.message}</p>
              )}
              {(it.skip_reason || it.error) && (
                <p className="mt-1 text-[11px] text-status-warning">{it.skip_reason || it.error}</p>
              )}
            </>
          )}
        />

        <Painel
          titulo="Classificação de etapa"
          icone={ViewColumnsIcon}
          config={stages?.config}
          hoje={stages?.hoje}
          itens={itensStage}
          carregando={carregando}
          erro={!stages && !carregando ? 'Endpoint de classificação indisponível.' : ''}
          onReload={carregar}
          linhas={(it) => (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                  {it.contact_name || `Contato #${it.contact_id}`}
                </span>
                <Pill status={it.status} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted2">
                {fmtDataHora(it.created_at)}
                {it.confidence != null && ` · confiança ${Number(it.confidence).toFixed(2)}`}
              </p>
              {it.to_stage && (
                <p className="mt-1 text-[12px] text-ink">
                  <span className="text-muted2">{it.from_stage || '—'}</span>
                  <span className="mx-1.5 text-muted2">→</span>
                  <span className="font-medium">{it.to_stage}</span>
                </p>
              )}
              {it.motivo && <p className="mt-0.5 text-[12px] text-muted">{it.motivo}</p>}
              {(it.skip_reason || it.error) && (
                <p className="mt-1 text-[11px] text-status-warning">{it.skip_reason || it.error}</p>
              )}
            </>
          )}
        />
      </div>

      {erro && (
        <p className={`${card} p-3 text-[13px] text-status-danger`}>{erro}</p>
      )}
    </div>
  );
}
