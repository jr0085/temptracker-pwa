// TempTracker Pro Service Worker
// Provides offline functionality and caching strategies

const CACHE_NAME = 'temptracker-pro-v1.0.0';
const STATIC_CACHE_NAME = 'temptracker-static-v1.0.0';
const DYNAMIC_CACHE_NAME = 'temptracker-dynamic-v1.0.0';

// Resources to cache immediately when service worker is installed
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/App.css',
  '/src/index.css',
  '/manifest.json'
];

// SharePoint and API endpoints that should not be cached
const NO_CACHE_URLS = [
  'https://cristyspizza.sharepoint.com',
  'https://login.microsoftonline.com',
  'https://graph.microsoft.com',
  '/_api/',
  '/contextinfo'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Service worker installed successfully');
        // Force the waiting service worker to become the active service worker
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches that don't match current version
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== DYNAMIC_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategy
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Skip caching for SharePoint and authentication requests
  if (shouldSkipCache(requestUrl.href)) {
    return;
  }
  
  // Handle different types of requests
  if (event.request.method === 'GET') {
    event.respondWith(handleGetRequest(event.request));
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync-temptracker') {
    event.waitUntil(syncOfflineActions());
  }
});

// Push notifications (for future temperature alerts)
self.addEventListener('push', (event) => {
  console.log('[SW] Push message received');
  
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'Temperature alert for your equipment',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      data: data,
      actions: [
        {
          action: 'view',
          title: 'View Details',
          icon: '/icons/action-view.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/action-dismiss.png'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'TempTracker Alert', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'view') {
    // Open the app and navigate to relevant page
    event.waitUntil(
      clients.openWindow('/?from=notification')
    );
  }
  // 'dismiss' action just closes the notification
});

// Helper functions

function shouldSkipCache(url) {
  return NO_CACHE_URLS.some(pattern => url.includes(pattern));
}

async function handleGetRequest(request) {
  const url = new URL(request.url);
  
  // For app shell and static assets - Cache First strategy
  if (isStaticAsset(url.pathname)) {
    return cacheFirst(request, STATIC_CACHE_NAME);
  }
  
  // For dynamic content - Network First strategy
  return networkFirst(request, DYNAMIC_CACHE_NAME);
}

function isStaticAsset(pathname) {
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2'];
  return staticExtensions.some(ext => pathname.endsWith(ext)) || 
         pathname === '/' || 
         pathname === '/index.html' ||
         pathname === '/manifest.json';
}

// Cache First strategy - try cache first, fallback to network
async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving from cache:', request.url);
      return cachedResponse;
    }
    
    console.log('[SW] Cache miss, fetching from network:', request.url);
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first strategy failed:', error);
    
    // Return offline fallback if available
    if (request.destination === 'document') {
      const cache = await caches.open(STATIC_CACHE_NAME);
      return cache.match('/index.html');
    }
    
    throw error;
  }
}

// Network First strategy - try network first, fallback to cache
async function networkFirst(request, cacheName) {
  try {
    console.log('[SW] Attempting network request:', request.url);
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving stale content from cache:', request.url);
      return cachedResponse;
    }
    
    // If it's a page request and we have no cache, return the app shell
    if (request.destination === 'document') {
      const staticCache = await caches.open(STATIC_CACHE_NAME);
      const appShell = await staticCache.match('/index.html');
      if (appShell) {
        return appShell;
      }
    }
    
    console.error('[SW] Network first strategy failed:', error);
    throw error;
  }
}

// Sync offline actions when network is restored
async function syncOfflineActions() {
  console.log('[SW] Syncing offline actions...');
  
  try {
    // Check if there are pending sync operations in localStorage
    const clients = await self.clients.matchAll();
    
    if (clients.length > 0) {
      // Send message to the main app to trigger sync
      clients.forEach(client => {
        client.postMessage({
          type: 'BACKGROUND_SYNC',
          action: 'SYNC_OFFLINE_DATA'
        });
      });
    }
    
    console.log('[SW] Background sync completed');
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
    throw error;
  }
}

// Utility function to send messages to the main app
function sendMessageToApp(message) {
  return self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}

// Handle version updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received skip waiting message');
    self.skipWaiting();
  }
});

console.log('[SW] Service worker script loaded');