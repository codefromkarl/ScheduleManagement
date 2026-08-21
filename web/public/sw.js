self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "goalset 提醒", body: "有一条新的日程提醒。", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data?.text() || data.body;
  }
  const operations = [self.registration.showNotification(data.title ?? "goalset 提醒", {
    body: data.body ?? "有一条新的日程提醒。",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: data.url ?? "/" },
  })];
  if (data.reminderId) {
    operations.push(fetch("/api/pwa/receipt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reminderId: data.reminderId }),
    }).catch(() => undefined));
  }
  event.waitUntil(Promise.all(operations));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
