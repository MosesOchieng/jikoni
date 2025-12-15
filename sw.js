self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("jikoni-shell-v1").then((cache) =>
      cache.addAll(["/", "/index.html", "/styles.css", "/main.js", "/manifest.webmanifest"])
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!key.startsWith("jikoni-shell-")) {
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


