import { useEffect, useState } from 'react';
import type { Account } from '../api/client';
import { client } from './client';
import { patiently } from './patiently';

/**
 * The account as the API has it, read again whenever `key` changes, such as when a job starts or
 * ends; nothing until it is read, when it cannot be, or without an account (`enabled`).
 */
export function useAccount(enabled: boolean, key: string): Account | undefined {
  const [account, setAccount] = useState<Account>();
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    patiently(() => client.getAccount()).then(
      (read) => current && setAccount(read),
      // A balance that could not be read again is no longer shown as if it were current.
      () => current && setAccount(undefined),
    );
    return () => {
      current = false;
    };
  }, [enabled, key]);
  return account;
}

/** A number of credits, in words. */
export const credits = (count: number) =>
  `${count.toLocaleString('en')} ${count === 1 ? 'credit' : 'credits'}`;
