const CACHE_NAME = "isomorphiq-v1";
const STATIC_CACHE_NAME = "isomorphiq-static-v1";
const DYNAMIC_CACHE_NAME = "isomorphiq-dynamic-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/favicon.svg",
  "/manifest.json",
  // Add other static assets as needed
];

const API_CACHE_TIME = 5 * 60 * 1000; // 5 minutes

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing...");
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log("Service Worker: Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating...");
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== DYNAMIC_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log("Service Worker: Deleting old cache", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache when offline
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Handle API requests
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc/")) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static assets
  if (STATIC_ASSETS.some(asset => url.pathname === asset || url.pathname.startsWith(asset))) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Handle page requests
  if (request.mode === "navigate") {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // Default handling
  event.respondWith(
    caches.match(request)
      .then((response) => {
        return response || fetch(request);
      })
  );
});

async function handleApiRequest(request) {
  try {
    // Try network first for API requests
    const response = await fetch(request);
    
    // Cache successful GET requests
    if (response.ok && request.method === "GET") {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      const responseClone = response.clone();
      await cache.put(request, responseClone);
    }
    
    return response;
  } catch (error) {
    console.log("Service Worker: API request failed, trying cache", request.url);
    
    // Try cache as fallback
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline response for API requests
    return new Response(
      JSON.stringify({
        error: "Offline",
        message: "No network connection and cached data not available",
        offline: true
      }),
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}

async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      const responseClone = response.clone();
      await cache.put(request, responseClone);
    }
    return response;
  } catch (error) {
    console.log("Service Worker: Static request failed", request.url);
    throw error;
  }
}

async function handlePageRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      const responseClone = response.clone();
      await cache.put(request, responseClone);
    }
    return response;
  } catch (error) {
    console.log("Service Worker: Page request failed, serving cached index", request.url);
    
    // Return cached index.html for all page requests when offline
    const cachedResponse = await caches.match("/index.html");
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page if available
    const offlineResponse = await caches.match("/offline.html");
    if (offlineResponse) {
      return offlineResponse;
    }
    
    // Fallback response
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Offline - Isomorphiq</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #0f172a;
              color: #e2e8f0;
              margin: 0;
              padding: 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              text-align: center;
            }
            .offline-container {
              max-width: 400px;
              padding: 40px 20px;
            }
            .offline-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              margin: 0 0 10px 0;
              font-size: 24px;
            }
            p {
              margin: 0 0 20px 0;
              color: #94a3b8;
              line-height: 1.5;
            }
            .retry-btn {
              background: #3b82f6;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              margin-bottom: 10px;
            }
            .retry-btn:hover {
              background: #2563eb;
            }
          </style>
        </head>
        <body>
          <div class="offline-container">
            <div class="offline-icon">📱</div>
            <h1>You're Offline</h1>
            <p>It looks like you've lost your internet connection. Some features may not be available until you're back online.</p>
            <button class="retry-btn" onclick="window.location.reload()">
              Try Again
            </button>
            <p style="font-size: 14px;">
              Your cached data is still available for viewing.
            </p>
          </div>
        </body>
      </html>
      `,
      {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
  }
}

// Background sync for offline actions
self.addEventListener("sync", (event) => {
  console.log("Service Worker: Background sync triggered", event.tag);
  
  if (event.tag === "background-sync") {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  try {
    // Get all clients and notify them to sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: "BACKGROUND_SYNC"
      });
    });
  } catch (error) {
    console.error("Service Worker: Background sync failed", error);
  }
}

// Push notifications
self.addEventListener("push", (event) => {
  console.log("Service Worker: Push received", event);
  
  const options = {
    body: event.data ? event.data.text() : "You have a new notification",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: "explore",
        title: "Explore",
        icon: "/favicon.svg"
      },
      {
        action: "close",
        title: "Close",
        icon: "/favicon.svg"
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification("Isomorphiq", options)
  );
});

// Notification click handling
self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification click received", event);
  
  event.notification.close();
  
  if (event.action === "explore") {
    event.waitUntil(
      clients.openWindow("/")
    );
  }
});

// Message handling from clients
self.addEventListener("message", (event) => {
  console.log("Service Worker: Message received", event.data);
  
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === "CACHE_URLS") {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE_NAME)
        .then((cache) => cache.addAll(event.data.urls))
    );
  }
});
