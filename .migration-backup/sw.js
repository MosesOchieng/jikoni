self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("mama-mboga-shell-v1").then((cache) =>
      cache.addAll(["/", "/index.html", "/styles.css", "/main.js", "/manifest.webmanifest"])
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!key.startsWith("mama-mboga-shell-")) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) =>
      fetch(request)
        .then((response) => {
          // Network success, optionally update cache in background
          return response;
        })
        .catch(() => {
          // Network failed – fall back to cache if we have it
      if (cached) return cached;
          // Last resort: empty offline response instead of crashing SW
          return new Response("", {
            status: 504,
            statusText: "Offline",
          });
    })
    )
  );
});

// Push notification event listener
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: "Mama Mboga", body: event.data.text() || "You have a new update" };
    }
  } else {
    data = { title: "Mama Mboga", body: "You have a new update" };
  }

  const options = {
    title: data.title || "Mama Mboga",
    body: data.body || "You have a new update",
    icon: "/public/logo.png",
    badge: "/public/logo.png",
    tag: data.tag || "mama-mboga-notification",
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const urlToOpen = data.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});


