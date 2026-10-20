import { ApiError } from '../api/client';

/**
 * Makes a request, again after the time the API asks for when it is busy or limits the rate, a
 * few times at most.
 */
export async function patiently<T>(request: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (reason) {
      const busy = reason instanceof ApiError && (reason.status === 429 || reason.status === 503);
      if (!busy || attempt >= attempts) throw reason;
      const seconds = Number(reason.headers.get('Retry-After') ?? 1);
      await new Promise((resolve) =>
        setTimeout(resolve, (Number.isFinite(seconds) && seconds >= 0 ? seconds : 1) * 1000),
      );
    }
  }
}
