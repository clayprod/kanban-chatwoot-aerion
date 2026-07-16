import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  BellIcon,
  DevicePhoneMobileIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  btnPrimary,
  btnSecondary,
  btnSecondarySm,
  btnGhostSm,
  card,
  cardAlt,
  sectionTitle,
  subtle,
  badge,
} from './ui';
import {
  NOTIFICATION_CATEGORIES,
  typesByCategory,
  typeLabel,
} from './notificationCatalog';
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getCurrentPushSubscription,
  getNotificationPermission,
  isIosDevice,
  isPushSupported,
  isStandaloneDisplay,
  registerPushServiceWorker,
} from './pushClient';

const Toggle = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={[
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
      checked ? 'bg-primary' : 'bg-line',
      disabled ? 'opacity-40 pointer-events-none' : 'hover:brightness-110',
      'focus:outline-none focus:ring-2 focus:ring-primary/30',
    ].join(' ')}
  >
    <span
      className={[
        'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
        checked ? 'translate-x-5' : 'translate-x-0.5',
      ].join(' ')}
    />
  </button>
);

const formatWhen = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

export default function NotificationsView({ onNavigate }) {
  const [prefs, setPrefs] = useState(null);
  const [catalog, setCatalog] = useState({ categories: NOTIFICATION_CATEGORIES, types: [] });
  const [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushState, setPushState] = useState({
    supported: false,
    permission: 'default',
    subscribed: false,
    standalone: false,
    ios: false,
    vapidOk: null,
    deviceCount: 0,
  });
  const [notice, setNotice] = useState(null);

  const refreshPushState = useCallback(async () => {
    const supported = isPushSupported();
    const standalone = isStandaloneDisplay();
    const ios = isIosDevice();
    let subscribed = false;
    let vapidOk = null;
    let deviceCount = 0;
    if (supported) {
      try {
        await registerPushServiceWorker();
        const sub = await getCurrentPushSubscription();
        subscribed = Boolean(sub);
      } catch {
        /* ignore */
      }
    }
    try {
      const { data } = await axios.get('/api/notifications/push/status');
      vapidOk = Boolean(data?.vapid_configured);
      deviceCount = Number(data?.device_count) || 0;
    } catch (error) {
      if (error?.response?.status === 503 || error?.response?.status === 400) {
        vapidOk = false;
      }
    }
    setPushState({
      supported,
      permission: getNotificationPermission(),
      subscribed,
      standalone,
      ios,
      vapidOk,
      deviceCount,
    });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [prefsRes, inboxRes] = await Promise.all([
        axios.get('/api/notifications/preferences'),
        axios.get('/api/notifications', { params: { limit: 40 } }),
      ]);
      setPrefs(prefsRes.data?.prefs || null);
      if (prefsRes.data?.catalog) {
        setCatalog({
          categories: prefsRes.data.catalog.categories || NOTIFICATION_CATEGORIES,
          types: prefsRes.data.catalog.types || [],
        });
      }
      setInbox(Array.isArray(inboxRes.data?.items) ? inboxRes.data.items : []);
      await refreshPushState();
    } catch (error) {
      const msg = error?.response?.data?.error || error.message || 'Falha ao carregar notificações';
      setNotice({ tone: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [refreshPushState]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const savePrefs = async (next) => {
    setSaving(true);
    setNotice(null);
    try {
      const { data } = await axios.put('/api/notifications/preferences', next);
      setPrefs(data?.prefs || next);
      setNotice({ tone: 'ok', message: 'Preferências salvas.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.error || 'Não foi possível salvar.',
      });
    } finally {
      setSaving(false);
    }
  };

  const patchPrefs = (patch) => {
    if (!prefs) return;
    const next = {
      ...prefs,
      ...patch,
      categories: { ...prefs.categories, ...(patch.categories || {}) },
      types: { ...prefs.types, ...(patch.types || {}) },
    };
    if (patch.categories) {
      for (const [k, v] of Object.entries(patch.categories)) {
        next.categories[k] = { ...(prefs.categories?.[k] || {}), ...v };
      }
    }
    if (patch.types) {
      for (const [k, v] of Object.entries(patch.types)) {
        next.types[k] = { ...(prefs.types?.[k] || {}), ...v };
      }
    }
    setPrefs(next);
    savePrefs(next);
  };

  const handleEnablePush = async () => {
    setPushBusy(true);
    setNotice(null);
    try {
      await enablePushOnThisDevice({
        apiGet: (url) => axios.get(url),
        apiPost: (url, body) => axios.post(url, body),
      });
      await refreshPushState();
      // Master toggle on is applied server-side on subscribe; refresh prefs
      const { data } = await axios.get('/api/notifications/preferences');
      if (data?.prefs) setPrefs(data.prefs);
      setNotice({ tone: 'ok', message: 'Push ativado neste dispositivo.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.error || error.message || 'Falha ao ativar push.',
      });
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setNotice(null);
    try {
      await disablePushOnThisDevice({
        apiDelete: (url, body) => axios.delete(url, { data: body }),
      });
      await refreshPushState();
      const { data } = await axios.get('/api/notifications/preferences');
      if (data?.prefs) setPrefs(data.prefs);
      setNotice({ tone: 'ok', message: 'Push desativado neste dispositivo.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.error || error.message || 'Falha ao desativar push.',
      });
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    setNotice(null);
    try {
      const { data } = await axios.post('/api/notifications/test-push');
      setNotice({
        tone: 'ok',
        message: data?.sent > 0
          ? `Teste enviado para ${data.sent} dispositivo(s).`
          : 'Teste gravado no histórico, mas nenhum dispositivo recebeu (ative o push neste browser).',
      });
      const inboxRes = await axios.get('/api/notifications', { params: { limit: 40 } });
      setInbox(Array.isArray(inboxRes.data?.items) ? inboxRes.data.items : []);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.error || error.message || 'Falha no teste.',
      });
    } finally {
      setPushBusy(false);
    }
  };

  const markAllRead = async () => {
    try {
      await axios.post('/api/notifications/read', { all: true });
      setInbox((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.error || 'Não foi possível marcar como lidas.',
      });
    }
  };

  const openNotification = async (item) => {
    if (!item.read_at) {
      try {
        await axios.post('/api/notifications/read', { ids: [item.id] });
        setInbox((prev) => prev.map((n) => (
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n
        )));
      } catch {
        /* ignore */
      }
    }
    const view = item.data?.view;
    const sub = item.data?.sub;
    if (view && typeof onNavigate === 'function') {
      onNavigate(view, sub);
    }
  };

  if (loading) {
    return (
      <div className={`${subtle} py-16 text-center`}>
        Carregando notificações…
      </div>
    );
  }

  const categories = catalog.categories?.length
    ? catalog.categories
    : NOTIFICATION_CATEGORIES;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <header className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted2">Preferências</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Notificações</h1>
        <p className={`${subtle} max-w-xl`}>
          Ative push neste dispositivo (Chrome, Firefox, Edge, Safari e PWA no Android/iPhone)
          e escolha o que entra no sino e no push. Alertas WhatsApp das assinaturas continuam
          configurados em cada busca monitorada.
        </p>
      </header>

      {notice && (
        <div
          className={[
            'flex items-start gap-2 rounded-[12px] border px-3 py-2.5 text-sm',
            notice.tone === 'error'
              ? 'border-red/30 bg-red/10 text-red'
              : 'border-green/30 bg-green/10 text-green',
          ].join(' ')}
        >
          {notice.tone === 'error'
            ? <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            : <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Section 1: device push */}
      <section className={`${card} p-4 sm:p-5 space-y-4`}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <DevicePhoneMobileIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className={sectionTitle}>Push neste dispositivo</h2>
            <p className={`${subtle} mt-0.5`}>
              Funciona com a aba fechada. No iPhone, o app precisa estar na Tela de Início.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className={`${cardAlt} px-3 py-2.5 text-xs`}>
            <span className="text-muted">Suporte do browser</span>
            <p className="mt-0.5 font-semibold text-ink">
              {pushState.supported ? 'Sim' : 'Não suportado'}
            </p>
          </div>
          <div className={`${cardAlt} px-3 py-2.5 text-xs`}>
            <span className="text-muted">Permissão</span>
            <p className="mt-0.5 font-semibold text-ink capitalize">{pushState.permission}</p>
          </div>
          <div className={`${cardAlt} px-3 py-2.5 text-xs`}>
            <span className="text-muted">Inscrito neste device</span>
            <p className="mt-0.5 font-semibold text-ink">{pushState.subscribed ? 'Sim' : 'Não'}</p>
          </div>
          <div className={`${cardAlt} px-3 py-2.5 text-xs`}>
            <span className="text-muted">Devices na conta</span>
            <p className="mt-0.5 font-semibold text-ink">{pushState.deviceCount}</p>
          </div>
        </div>

        {pushState.vapidOk === false && (
          <p className="text-xs text-amber">
            Servidor sem VAPID configurado. Defina <code className="font-mono">VAPID_PUBLIC_KEY</code> e{' '}
            <code className="font-mono">VAPID_PRIVATE_KEY</code> no backend.
          </p>
        )}

        {pushState.ios && !pushState.standalone && (
          <div className={`${cardAlt} border-amber/30 bg-amber/5 px-3 py-3 text-xs text-ink`}>
            <p className="font-semibold text-amber">iPhone / iPad</p>
            <p className={`${subtle} mt-1`}>
              No Safari, toque em <strong className="text-ink">Compartilhar → Adicionar à Tela de Início</strong>,
              abra o Aerion pelo ícone e então ative o push (iOS 16.4+).
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!pushState.subscribed ? (
            <button
              type="button"
              className={btnPrimary}
              disabled={pushBusy || !pushState.supported || pushState.vapidOk === false}
              onClick={handleEnablePush}
            >
              {pushBusy ? 'Ativando…' : 'Ativar push neste dispositivo'}
            </button>
          ) : (
            <button
              type="button"
              className={btnSecondary}
              disabled={pushBusy}
              onClick={handleDisablePush}
            >
              {pushBusy ? 'Desativando…' : 'Desativar neste dispositivo'}
            </button>
          )}
          <button
            type="button"
            className={btnSecondarySm}
            disabled={pushBusy || !pushState.subscribed}
            onClick={handleTestPush}
          >
            Enviar teste
          </button>
        </div>

        {prefs && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-sm font-semibold text-ink">Receber push (geral)</p>
              <p className={subtle}>Master switch — desliga todos os pushes da conta neste usuário.</p>
            </div>
            <Toggle
              checked={Boolean(prefs.push_enabled)}
              label="Receber push"
              disabled={saving}
              onChange={(v) => patchPrefs({ push_enabled: v })}
            />
          </div>
        )}
      </section>

      {/* Section 2: hierarchy */}
      <section className={`${card} p-4 sm:p-5 space-y-5`}>
        <div>
          <h2 className={sectionTitle}>O que você recebe</h2>
          <p className={`${subtle} mt-0.5`}>
            Hierarquia por categoria e tipo. WhatsApp de watchlist fica no card de cada assinatura em Licitações.
          </p>
        </div>

        {prefs && categories.map((cat) => {
          const types = catalog.types?.length
            ? catalog.types.filter((t) => t.category === cat.id)
            : typesByCategory(cat.id);
          return (
            <div key={cat.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{cat.label}</p>
                  <p className={subtle}>{cat.description}</p>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    In-app
                    <Toggle
                      checked={Boolean(prefs.categories?.[cat.id]?.in_app)}
                      label={`${cat.label} in-app`}
                      disabled={saving}
                      onChange={(v) => patchPrefs({
                        categories: { [cat.id]: { in_app: v } },
                      })}
                    />
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    Push
                    <Toggle
                      checked={Boolean(prefs.categories?.[cat.id]?.push)}
                      label={`${cat.label} push`}
                      disabled={saving || !prefs.push_enabled}
                      onChange={(v) => patchPrefs({
                        categories: { [cat.id]: { push: v } },
                      })}
                    />
                  </span>
                </div>
              </div>

              <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
                {types.map((t) => {
                  const typeKey = t.type;
                  const typePref = prefs.types?.[typeKey] || { in_app: true, push: true };
                  return (
                    <li
                      key={typeKey}
                      className="flex flex-col gap-2 bg-bg2/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">{t.label}</p>
                        <p className="text-[11px] text-muted">{t.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-[11px] text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          In-app
                          <Toggle
                            checked={Boolean(typePref.in_app)}
                            label={`${t.label} in-app`}
                            disabled={saving}
                            onChange={(v) => patchPrefs({
                              types: { [typeKey]: { in_app: v } },
                            })}
                          />
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          Push
                          <Toggle
                            checked={Boolean(typePref.push)}
                            label={`${t.label} push`}
                            disabled={saving || !prefs.push_enabled}
                            onChange={(v) => patchPrefs({
                              types: { [typeKey]: { push: v } },
                            })}
                          />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Section 3: history */}
      <section className={`${card} p-4 sm:p-5 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BellIcon className="h-5 w-5 text-primary" />
            <h2 className={sectionTitle}>Histórico</h2>
            {inbox.some((n) => !n.read_at) && (
              <span className={badge}>
                {inbox.filter((n) => !n.read_at).length} não lida(s)
              </span>
            )}
          </div>
          <button type="button" className={btnGhostSm} onClick={markAllRead}>
            Marcar todas como lidas
          </button>
        </div>

        {inbox.length === 0 ? (
          <p className={`${subtle} py-6 text-center`}>Nenhuma notificação ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {inbox.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openNotification(item)}
                  className={[
                    'flex w-full gap-3 px-1 py-3 text-left transition hover:bg-surf2/60 rounded-lg',
                    !item.read_at ? 'opacity-100' : 'opacity-70',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      item.read_at ? 'bg-line' : 'bg-primary',
                    ].join(' ')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink">{item.title}</span>
                      <span className="font-mono text-[10px] text-muted2">{formatWhen(item.created_at)}</span>
                    </span>
                    {item.body && (
                      <span className="mt-0.5 block text-xs text-muted line-clamp-2">{item.body}</span>
                    )}
                    <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-wider text-muted2">
                      {typeLabel(item.type)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
