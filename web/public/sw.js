// SquadSense service worker: shows alerts the sync job sends by web push,
// even when the site isn't open, and opens the right page when tapped.
// It doesn't cache pages, so the site always shows the latest data.

// Shows one alert. The sync sends {title, body, url} as JSON.
self.addEventListener("push", (event) => {
  const alert = event.data ? event.data.json() : { title: "SquadSense", body: "", url: "/" };
  event.waitUntil(
    self.registration.showNotification(alert.title, {
      body: alert.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: alert.url || "/" },
    }),
  );
});

// Tapping an alert focuses an open SquadSense tab on that page, or opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      return open ? open.navigate(url).then((client) => client && client.focus()) : self.clients.openWindow(url);
    }),
  );
});
