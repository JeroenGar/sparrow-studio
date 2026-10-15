// Add isolation headers on static hosts that cannot configure response headers.
// No cache: imported drawings and solver messages never pass through this worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    const body = [204, 205, 304].includes(response.status) ? null : response.body;
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }));
});
