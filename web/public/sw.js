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
  const data = event.data?.json?.() ?? { title: "goalset 提醒", body: "有一条新的日程提醒。", url: "/" };
  event.waitUntil(self.registration.showNotification(data.title ?? "goalset 提醒", {
    body: data.body ?? "有一条新的日程提醒。",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: data.url ?? "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? "/"));
});
