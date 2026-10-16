import { createClient } from '../api/client';
import { browserEngine } from '../backend/engine';
import { createLocalBackend } from '../backend/local';

/**
 * Studio's API client. Without signing in, the local backend answers it in this browser, with
 * open-source sparrow; the address is never reached.
 */
export const client = createClient({
  baseUrl: 'https://local.sparrow.studio/v1',
  fetch: createLocalBackend(browserEngine),
});
