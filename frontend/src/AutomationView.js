import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ViewColumnsIcon,
  MagnifyingGlassCircleIcon,
  PauseCircleIcon,
  ChevronDownIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { btnGhostXs, card, cardAlt, iconBtn, input, subtle } from './ui';

// Painel de leitura da automação comercial: o que a IA mandou e o que ela moveu.
// Os dois workers rodam sozinhos; sem esta tela a única forma de saber se estão
// vivos é consultar o banco — e já ficaram dias parados sem ninguém perceber.
//
// A maior parte do volume é ruído ("etapa já está correta", "confiança abaixo do
// mínimo"): são decisões corretas de NÃO fazer nada. Ficam fora da lista por padrão,
// contadas no resumo, a um clique de distância.

const PAGINA = 15;

const fmtDataHora = (valor) => {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const horasDesde = (valor) => {
  const t = new Date(valor || 0).getTime();
  return Number.isFinite(t) && t > 0 ? (Date.now() - t) / 3600000 : null;
};

const STATUS = {
  sent:      { cor: 'text-status-success', rotulo: 'enviado',  ruido: false },
  applied:   { cor: 'text-status-success', rotulo: 'movido',   ruido: false },
  dry_run:   { cor: 'text-status-warning', rotulo: 'simulado', ruido: false },
  suggested: { cor: 'text-primary',        rotulo: 'sugerido', ruido: false },
  failed:    { cor: 'text-status-danger',  rotulo: 'falhou',   ruido: false },
  provider_unavailable: { cor: 'text-status-warning', rotulo: 'aguardando provedor', ruido: false },
  retrying:  { cor: 'text-primary', rotulo: 'retomando', ruido: false },
  queued:    { cor: 'text-primary', rotulo: 'na fila de envio', ruido: false },
  enfileirado: { cor: 'text-primary', rotulo: 'na fila de envio', ruido: false },
  abordado: { cor: 'text-status-success', rotulo: 'enviado', ruido: false },
  falhou: { cor: 'text-status-danger', rotulo: 'falhou', ruido: false },
  descartado: { cor: 'text-muted2', rotulo: 'descartado', ruido: false },
  escalated: { cor: 'text-status-warning', rotulo: 'encaminhado ao atendimento', ruido: false },
  skipped:   { cor: 'text-muted2',         rotulo: 'pulado',   ruido: true },
};
const meta = (s) => STATUS[s] || { cor: 'text-muted2', rotulo: s, ruido: false };

function Switch({ ligado, onChange, salvando, rotulo, titulo }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={titulo || rotulo}
      title={titulo}
      disabled={salvando}
      onClick={() => onChange(!ligado)}
      className={`flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
        ligado ? 'text-ink' : 'text-muted'
      } hover:bg-bg2`}
    >
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          ligado ? 'bg-primary' : 'bg-line2'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            ligado ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
      {rotulo}
    </button>
  );
}

function Saude({ config, ultima }) {
  if (!config) return null;
  // O texto antigo culpava deploy por ter limpado variável de ambiente. Isso deixou
  // de ser verdade quando o estado passou a morar em ai_settings: hoje, se está
  // desligado, é porque alguém desligou (ou nunca ligou) — e liga no botão ao lado.
  if (!config.enabled) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] border border-line bg-bg2/60 p-2.5 text-[12px] text-muted">
        <PauseCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong className="text-ink">Desligado.</strong> Este worker não está rodando.
          Use o botão <em>Desligado</em> acima para ligar — fica gravado no banco e sobrevive a deploy.
        </span>
      </div>
    );
  }
  if (config.dry_run) {
    return (
      <div className="rounded-[10px] border border-status-warning/30 bg-status-warning/10 p-2.5 text-[12px] text-status-warning">
        <strong>Modo sombra.</strong> Decide e registra, mas não executa nada.
      </div>
    );
  }
  const h = horasDesde(ultima);
  if (h !== null && h > 48) {
    return (
      <div className="rounded-[10px] border border-status-warning/30 bg-status-warning/10 p-2.5 text-[12px] text-status-warning">
        Ligado, sem atividade há {Math.floor(h / 24)} dia(s). Pode ser fila vazia — ou algo travado.
      </div>
    );
  }
  return null;
}

function Item({ it, children }) {
  const [aberto, setAberto] = useState(false);
  const m = meta(it.status);
  const detalhe = it.skip_reason || it.error;
  return (
    <li className={`${cardAlt} px-3 py-2`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={aberto}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-muted2 transition ${aberto ? '' : '-rotate-90'}`} />
            <span className="truncate text-[13px] font-semibold text-ink">
              {it.contact_name || it.razao_social
                || (it.contact_id ? `Contato #${it.contact_id}` : 'Sem contato associado')}
            </span>
          </span>
          <span className="mt-0.5 block pl-5 text-[11px] text-muted2">
            {fmtDataHora(it.created_at)}
            {it.confidence != null && ` · conf ${Number(it.confidence).toFixed(2)}`}
          </span>
        </button>
        <span className={`shrink-0 text-[11px] font-semibold ${m.cor}`}>{m.rotulo}</span>
      </div>
      {aberto && <div className="mt-1.5 space-y-1 pl-5">{children}</div>}
      {!aberto && detalhe && (
        <p className="mt-0.5 truncate pl-5 text-[11px] text-muted2">{detalhe}</p>
      )}
    </li>
  );
}

function Painel({ dados, carregando, onReload, busca, linhas, vazio, chaves, onToggle, salvando }) {
  const [verRuido, setVerRuido] = useState(false);
  const [limite, setLimite] = useState(PAGINA);

  const todos = dados?.decisoes || [];
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos.filter((it) => {
      if (!verRuido && meta(it.status).ruido) return false;
      if (!q) return true;
      return [it.contact_name, it.message, it.motivo, it.skip_reason, it.to_stage, it.from_stage]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [todos, busca, verRuido]);

  const ruidoOculto = todos.filter((it) => meta(it.status).ruido).length;
  const visiveis = filtrados.slice(0, limite);

  return (
    <div className="space-y-2.5">
      <Saude config={dados?.config} ultima={todos[0]?.created_at} />
      {dados?.runtime && (
        <div role="status" className={`rounded-[10px] border border-line p-3 text-[12px] ${dados.runtime.error || dados.runtime.summary?.falhas ? 'text-status-warning' : 'text-muted'}`}>
          <p className="font-medium text-ink">Último ciclo: {fmtDataHora(dados.runtime.started_at)} · {dados.runtime.finished_at ? 'Concluído' : 'Em execução'}</p>
          {dados.runtime.finished_at && <p className="mt-1">{dados.runtime.error || dados.runtime.summary?.skipped || `${dados.runtime.summary?.avaliados || 0} empresas avaliadas · ${dados.runtime.summary?.abordados || 0} abordagens preparadas · ${dados.runtime.summary?.falhas || 0} falhas`}</p>}
          {(dados.runtime.summary?.errosBusca || []).map((reason,i)=><p className="mt-1 break-words" key={i}>{reason}</p>)}
          <p className="mt-1">Ciclos aos 20 minutos de cada hora, no horário comercial. Envio depende da verificação do WhatsApp e da disponibilidade do número.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
        {Object.entries(dados?.hoje || {}).map(([s, n]) => (
          <span key={s} className={meta(s).cor}>
            {n} <span className="text-muted2">{meta(s).rotulo}</span>
          </span>
        ))}
        {!Object.keys(dados?.hoje || {}).length && <span className={subtle}>nada hoje</span>}
        <span className="ml-auto flex items-center gap-1">
          {chaves && (
            <>
              <Switch
                ligado={Boolean(dados?.config?.enabled)}
                onChange={(v) => onToggle(chaves.enabled, v)}
                salvando={salvando}
                rotulo={dados?.config?.enabled ? 'Ligado' : 'Desligado'}
                titulo="Liga e desliga este worker. Fica gravado no banco, então sobrevive a deploy."
              />
              <Switch
                ligado={Boolean(dados?.config?.dry_run)}
                onChange={(v) => onToggle(chaves.dryRun, v)}
                salvando={salvando}
                rotulo="Sombra"
                titulo="Modo sombra: a IA decide e registra, mas não executa nada."
              />
              <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            </>
          )}
          {ruidoOculto > 0 && (
            <button type="button" onClick={() => setVerRuido((v) => !v)} className={btnGhostXs}>
              {verRuido ? 'Ocultar' : `Ver ${ruidoOculto} pulado(s)`}
            </button>
          )}
          <button type="button" onClick={onReload} className={`${iconBtn} h-7 w-7`} title="Atualizar">
            <ArrowPathIcon className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
          </button>
        </span>
      </div>

      <ul className="space-y-1.5">
        {!visiveis.length && !carregando && (
          <li className={`${subtle} py-8 text-center`}>{vazio}</li>
        )}
        {visiveis.map((it) => <Item key={it.id} it={it}>{linhas(it)}</Item>)}
      </ul>

      {filtrados.length > visiveis.length && (
        <button
          type="button"
          onClick={() => setLimite((n) => n + PAGINA)}
          className={`${btnGhostXs} w-full py-2`}
        >
          Mostrar mais {Math.min(PAGINA, filtrados.length - visiveis.length)} de {filtrados.length - visiveis.length}
        </button>
      )}
    </div>
  );
}

export default function AutomationView() {
  const [followups, setFollowups] = useState(null);
  const [stages, setStages] = useState(null);
  const [prospeccao, setProspeccao] = useState(null);
  const [responder, setResponder] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [aba, setAba] = useState('followup');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const [f, s, p, resp] = await Promise.all([
        axios.get('/api/ai-followups?limit=120').catch((e) => ({ error: e })),
        axios.get('/api/ai-stages?limit=120').catch((e) => ({ error: e })),
        axios.get('/api/prospeccao?limit=120').catch((e) => ({ error: e })),
        axios.get('/api/ai-responder?limit=120').catch((e) => ({ error: e })),
      ]);
      if (f.error && s.error && p.error && resp.error) throw f.error;
      setFollowups(f.error ? null : f.data);
      setStages(s.error ? null : s.data);
      setProspeccao(p.error ? null : p.data);
      setResponder(resp.error ? null : resp.data);
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível carregar a atividade da automação.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = useCallback(async (chave, valor) => {
    setSalvando(true);
    setErro('');
    try {
      await axios.post('/api/ai-settings', { [chave]: valor });
      await carregar();
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível salvar a configuração.');
    } finally {
      setSalvando(false);
    }
  }, [carregar]);

  // Acatar a sugestao da IA. Ela sugere em vez de mover quando o alvo e marco
  // comercial ou quando a confianca nao chega na regua; sem este botao a sugestao
  // morria no painel e alguem tinha que mover na mao no kanban.
  const [acatando, setAcatando] = useState(null);
  const acatar = useCallback(async (id) => {
    setAcatando(id);
    setErro('');
    try {
      await axios.post(`/api/ai-stages/${id}/aplicar`);
      await carregar();
    } catch (e) {
      setErro(e?.response?.data?.error || 'Não foi possível aplicar a sugestão.');
    } finally {
      setAcatando(null);
    }
  }, [carregar]);

  const abas = [
    { id: 'followup', nome: 'Follow-up', icone: ChatBubbleLeftRightIcon, n: followups?.hoje?.sent || 0 },
    { id: 'etapa', nome: 'Classificação de etapa', icone: ViewColumnsIcon, n: (stages?.hoje?.applied || 0) + (stages?.hoje?.dry_run || 0) },
    { id: 'prospeccao', nome: 'Prospecção ativa', icone: MagnifyingGlassCircleIcon, n: (prospeccao?.hoje?.abordado || 0) + (prospeccao?.hoje?.enfileirado || 0) + (prospeccao?.hoje?.dry_run || 0) },
    { id: 'responder', nome: 'Respondedor', icone: ChatBubbleLeftRightIcon, n: (responder?.hoje?.sent || 0) + (responder?.hoje?.dry_run || 0) },
  ];

  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="flex items-center gap-1" role="tablist">
          {abas.map((a) => {
            const ativa = aba === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => setAba(a.id)}
                className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition ${
                  ativa ? 'bg-primary/[0.12] text-primary' : 'text-muted hover:bg-bg2 hover:text-ink'
                }`}
              >
                <a.icone className="h-4 w-4" />
                {a.nome}
                {a.n > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums text-primary">
                    {a.n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por contato, mensagem ou motivo…"
          className={`${input} h-8 w-full text-sm sm:w-72`}
          aria-label="Filtrar atividade"
        />
      </div>

      <div className="pt-3">
        {aba === 'followup' && (
          <Painel
            dados={followups}
            carregando={carregando}
            onReload={carregar}
            busca={busca}
            chaves={{ enabled: 'followup_enabled', dryRun: 'followup_dry_run' }}
            onToggle={alternar}
            salvando={salvando}
            vazio="Nenhum follow-up registrado ainda."
            linhas={(it) => (
              <>
                {it.message && <p className="whitespace-pre-wrap text-[12px] text-muted">{it.message}</p>}
                {(it.skip_reason || it.error) && (
                  <p className="text-[11px] text-status-warning">{it.skip_reason || it.error}</p>
                )}
                {it.provider && (
                  <p className="text-[10px] text-muted2">{it.provider} · {it.model}</p>
                )}
              </>
            )}
          />
        )}
        {aba === 'etapa' && (
          <Painel
            dados={stages}
            carregando={carregando}
            onReload={carregar}
            busca={busca}
            chaves={{ enabled: 'stage_enabled', dryRun: 'stage_dry_run' }}
            onToggle={alternar}
            salvando={salvando}
            vazio="Nenhuma classificação registrada ainda."
            linhas={(it) => (
              <>
                {it.to_stage && (
                  <p className="text-[12px] text-ink">
                    <span className="text-muted2">{it.from_stage || '—'}</span>
                    <span className="mx-1.5 text-muted2">→</span>
                    <span className="font-medium">{it.to_stage}</span>
                  </p>
                )}
                {it.motivo && <p className="text-[12px] text-muted">{it.motivo}</p>}
                {(it.skip_reason || it.error) && (
                  <p className="text-[11px] text-status-warning">{it.skip_reason || it.error}</p>
                )}
                {it.status === 'suggested' && it.to_stage && (
                  <button
                    type="button"
                    onClick={() => acatar(it.id)}
                    disabled={acatando === it.id}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-accent/40
                               bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent
                               transition hover:bg-accent/20 disabled:opacity-50"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    {acatando === it.id ? 'Movendo...' : `Acatar e mover para ${it.to_stage}`}
                  </button>
                )}
              </>
            )}
          />
        )}
        {aba === 'prospeccao' && (
          <Painel
            dados={prospeccao}
            carregando={carregando}
            onReload={carregar}
            busca={busca}
            chaves={{ enabled: 'prospeccao_enabled', dryRun: 'prospeccao_dry_run' }}
            onToggle={alternar}
            salvando={salvando}
            vazio="Nenhuma empresa prospectada ainda."
            linhas={(it) => (
              <>
                {it.telefone && (
                  <p className="text-[12px] text-muted">
                    <span className="font-mono">{it.telefone}</span>
                    {it.perfil_whatsapp && <span className="text-muted2"> · perfil "{it.perfil_whatsapp}"</span>}
                  </p>
                )}
                {/* O que mais importa auditar: a IA sabia que era a empresa certa? */}
                {it.confirmou_empresa === false && (
                  <p className="text-[11px] text-status-warning">
                    Perfil não confirmou a empresa — a abertura pergunta com quem está falando.
                  </p>
                )}
                {it.mensagem && <p className="whitespace-pre-wrap text-[12px] text-muted">{it.mensagem}</p>}
                {(it.motivo || it.error) && (
                  <p className="text-[11px] text-muted2">{it.error || it.motivo}</p>
                )}
                {it.perfil && <p className="text-[10px] text-muted2">perfil: {it.perfil}</p>}
              </>
            )}
          />
        )}
      </div>

        {aba === 'responder' && (
          <Painel
            dados={responder}
            carregando={carregando}
            onReload={carregar}
            busca={busca}
            chaves={{ enabled: 'responder_enabled', dryRun: 'responder_dry_run' }}
            onToggle={alternar}
            salvando={salvando}
            vazio="Ninguém ficou sem resposta ainda."
            linhas={(it) => (
              <>
                {it.pergunta && (
                  <p className="text-[12px] text-ink">
                    <span className="text-muted2">perguntou: </span>
                    {it.pergunta}
                  </p>
                )}
                {it.mensagem && <p className="whitespace-pre-wrap text-[12px] text-muted">{it.mensagem}</p>}
                {(it.motivo || it.error) && (
                  <p className="text-[11px] text-muted2">{it.motivo || it.error}</p>
                )}
                {it.icp && <p className="text-[10px] text-muted2">perfil: {it.icp}</p>}
              </>
            )}
          />
        )}
      {erro && <p className="mt-3 text-[13px] text-status-danger">{erro}</p>}
    </div>
  );
}
