import { useEffect, useState } from 'react';
import type { Schemas } from '../api/client';
import { client } from './client';

let asked: Promise<Schemas['Limits']> | undefined;

/** The backend's limits, asked once per page; undefined until they arrive or when they cannot. */
export function useLimits(): Schemas['Limits'] | undefined {
  const [limits, setLimits] = useState<Schemas['Limits']>();
  useEffect(() => {
    let current = true;
    asked ??= client.getLimits();
    asked.then(
      (value) => current && setLimits(value),
      () => {
        // Asked again next time; until then, the backend refuses what it cannot take.
        asked = undefined;
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return limits;
}
