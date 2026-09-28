// City Markets Service Worker v2
// Strategy: network-first for HTML/API, cache-first for static assets.
// Features: Background sync, offline cart, image caching

const CACHE_VERSION = "cm-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

const PRECACHE_URLS = [
  "/",
  "/catalog",
  "/categories",
  "/deals",
  "/manifest.json",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/citymarket-logo.png",
  "/offline",
];

// Install: pre-cache the shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (err) {
        console.warn("[sw] pre-cache partial:", err);
      }
      await self.skipWaiting();
    })(),
  );
});

// Activate: clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Fetch: route by request type.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Bypass: admin/vendor, auth, API mutations, socket
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/vendor/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/profile")
  ) {
    return;
  }

  // HTML pages: network-first with offline fallback.
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Images: cache-first with network fallback, limited cache size
  if (url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i)) {
    event.respondWith(imageCache(request));
    return;
  }

  // Static assets: cache-first.
  if (url.pathname.match(/\.(js|css|ico|woff2?)$/i)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default: try network, fall back to cache.
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || new Response("", { status: 504 });
  }
}

async function imageCache(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Only cache images under 500KB
      const clone = response.clone();
      const body = await clone.blob();
      if (body.size < 500 * 1024) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (err) {
    return cached || new Response("", { status: 504 });
  }
}

// Background Sync: Cart operations
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-cart") {
    event.waitUntil(syncCart());
  }
});

async function syncCart() {
  try {
    // Get pending cart operations from IndexedDB
    const db = await openCartDB();
    const tx = db.transaction("pending", "readonly");
    const store = tx.objectStore("pending");
    const operations = await getAllFromStore(store);
    
    for (const op of operations) {
      try {
        await fetch(op.url, {
          method: op.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.body),
        });
        // Remove from pending after successful sync
        const deleteTx = db.transaction("pending", "readwrite");
        await deleteFromStore(deleteTx.objectStore("pending"), op.id);
      } catch (err) {
        console.error("[sw] Cart sync failed:", err);
      }
    }
  } catch (err) {
    console.error("[sw] Cart sync error:", err);
  }
}

function openCartDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("citymarket-cart", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("pending")) {
        db.createObjectStore("pending", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function deleteFromStore(store, id) {
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Push: order updates.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "أسواق سيتي", body: event.data.text() };
  }
  const title = payload.title || "أسواق سيتي";
  const options = {
    body: payload.body || "تم تحديث حالة طلبك",
    icon: "/android-chrome-192x192.png",
    badge: "/android-chrome-192x192.png",
    dir: "rtl",
    lang: "ar",
    data: { url: payload.url || "/orders" },
    tag: payload.tag || "order-update",
    renotify: true,
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click: focus or open the order.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/orders";
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes(targetUrl) && "focus" in c) return c.focus();
      }
      return clients.openWindow(targetUrl);
    })(),
  );
});
