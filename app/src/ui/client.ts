import { createClient, type Fetch } from '../api/client';
import { browserEngine } from '../backend/engine';
import { createLocalBackend } from '../backend/local';
import { browserRecords } from '../backend/projects';

/**
 * During development, studio can use a Sparrow Pro API, such as the local Docker Compose stack,
 * with an API key, instead of signing in: set VITE_SPARROW_API_URL (with /v1) and
 * VITE_SPARROW_API_KEY. Under the path /local it keeps using open-source sparrow in this browser,
 * so both can be open side by side. Published builds never read any of this.
 */
const developmentApi =
  import.meta.env.DEV && !location.pathname.startsWith('/local')
    ? {
        url: import.meta.env.VITE_SPARROW_API_URL as string | undefined,
        key: import.meta.env.VITE_SPARROW_API_KEY as string | undefined,
      }
    : undefined;

function withKey(key: string): Fetch {
  return (request) => {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${key}`);
    return fetch(new Request(request, { headers }));
  };
}

/** Whether studio talks to Sparrow Pro rather than to open-source sparrow in this browser. */
export const usesSparrowPro = !!(developmentApi?.url && developmentApi.key);

/**
 * Studio's API client. Without signing in, the local backend answers it in this browser, with
 * open-source sparrow and browser storage; its address is never reached.
 */
export const client = usesSparrowPro
  ? createClient({ baseUrl: developmentApi!.url!, fetch: withKey(developmentApi!.key!) })
  : createClient({
      baseUrl: 'https://local.sparrow.studio/v1',
      fetch: createLocalBackend(browserEngine, browserRecords),
    });

/** Where studio solves and saves, as its interface says it. */
export const backend = usesSparrowPro
  ? { solves: 'with sparrow pro', saves: 'in sparrow pro' }
  : { solves: 'in this browser with open-source sparrow', saves: 'in this browser' };
