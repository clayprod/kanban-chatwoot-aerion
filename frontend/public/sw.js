/* Aerion — service worker for Web Push */
/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Aerion',
    body: 'Nova notificação',
    data: {},
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || '',
        data: {
          ...(parsed.data || {}),
          type: parsed.type,
          category: parsed.category,
          id: parsed.id,
          view: parsed.view || parsed.data?.view || null,
          sub: parsed.sub || parsed.data?.sub || null,
          url: parsed.url || parsed.data?.url || '/',
        },
      };
    }
  } catch (err) {
    try {
      payload.body = event.data ? event.data.text() : payload.body;
    } catch (_) {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo192.png',
      badge: '/favicon-32.png',
      data: payload.data,
      tag: payload.data?.type
        ? `${payload.data.type}:${payload.data.id || 'n'}`
        : 'aerion-notification',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url && String(data.url).startsWith('http')
    ? data.url
    : self.location.origin + (data.url || '/');

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({
            type: 'aerion-notification-click',
            view: data.view || null,
            sub: data.sub || null,
            job_id: data.job_id || null,
            notification_id: data.id || null,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        const opened = await self.clients.openWindow(targetUrl);
        if (opened) {
          // Navigation deep-link is best-effort; client may re-read from URL later.
        }
      }
    })()
  );
});
