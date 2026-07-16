/**
 * Client-side Web Push helpers (subscribe / unsubscribe / SW register).
 */

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const isPushSupported = () => {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
  );
};

export const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari
  const iosStandalone = window.navigator.standalone === true;
  return Boolean(mq || iosStandalone);
};

export const isIosDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const getNotificationPermission = () => {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
};

export const registerPushServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (error) {
    console.warn('[push] service worker register failed:', error.message);
    return null;
  }
};

export const getCurrentPushSubscription = async () => {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
};

/**
 * @param {(path: string) => Promise<{ data: any }>} apiGet axios-like getter for vapid key
 * @param {(path: string, body: any) => Promise<any>} apiPost
 */
export const enablePushOnThisDevice = async ({ apiGet, apiPost }) => {
  if (!isPushSupported()) {
    throw new Error('Este navegador não suporta Web Push.');
  }
  if (isIosDevice() && !isStandaloneDisplay()) {
    throw new Error(
      'No iPhone/iPad, adicione o Aerion à Tela de Início e abra pelo ícone para ativar push (iOS 16.4+).'
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Permissão de notificação bloqueada no navegador. Libere nas configurações do site.'
        : 'Permissão de notificação não concedida.'
    );
  }

  const { data: vapid } = await apiGet('/api/notifications/vapid-public-key');
  if (!vapid?.publicKey) {
    throw new Error('Servidor sem chave VAPID. Configure VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.');
  }

  const reg = await registerPushServiceWorker();
  if (!reg) throw new Error('Não foi possível registrar o service worker.');

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }

  await apiPost('/api/notifications/push/subscribe', {
    subscription: subscription.toJSON(),
    user_agent: navigator.userAgent,
  });

  return subscription;
};

/**
 * @param {(path: string, body: any) => Promise<any>} apiDelete
 */
export const disablePushOnThisDevice = async ({ apiDelete }) => {
  if (!isPushSupported()) return { ok: true };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const subscription = reg ? await reg.pushManager.getSubscription() : null;
  const endpoint = subscription?.endpoint || null;
  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch (error) {
      console.warn('[push] unsubscribe local failed:', error.message);
    }
  }
  if (endpoint && apiDelete) {
    await apiDelete('/api/notifications/push/unsubscribe', { endpoint });
  }
  return { ok: true };
};
