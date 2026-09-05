// Reload only during startup, before the editor can contain unsaved work.
export async function prepareIsolation(): Promise<void> {
  if (crossOriginIsolated || !isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    const url = new URL(`${import.meta.env.BASE_URL}isolation-worker.js`, document.baseURI);
    const key = `sparrow-isolation:${url.pathname}`;
    if (sessionStorage.getItem(key)) return;
    const ready = (async () => {
      const registration = await navigator.serviceWorker.register(url, { scope: new URL('.', url).pathname });
      if (!registration.active || !navigator.serviceWorker.controller) {
        await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      }
      return true;
    })();
    const controlled = await Promise.race([ready, new Promise<false>(resolve => setTimeout(() => resolve(false), 2000))]);
    if (controlled) {
      sessionStorage.setItem(key, '1');
      location.reload();
      // Do not mount the editor while the replacement document is loading.
      await new Promise(() => {});
    }
  } catch {
    // Restricted storage or service workers: the serial solver remains available.
  }
}
