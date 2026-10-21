import { useEffect, useState } from 'react';
import type { Account } from '../api/client';
import { client } from './client';
import { patiently } from './patiently';

/** The account as the API has it when this is first shown; nothing until it is read, or when it cannot be. */
export function useAccount(): Account | undefined {
  const [account, setAccount] = useState<Account>();
  useEffect(() => {
    let current = true;
    patiently(() => client.getAccount()).then(
      (read) => current && setAccount(read),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  return account;
}
