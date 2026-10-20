import { useEffect, useState } from 'react';
import type { Tab } from './context';

/** Where studio is: home, or a tab of a project. */
export type Route = { page: 'home' } | { page: 'project'; id: string; tab: Tab };

const TABS: Tab[] = ['parts', 'sheets', 'machine', 'settings', 'live', 'solution'];

/** The route of a location hash, such as `#/projects/<id>/sheets`; anything else is home. */
export function parseRoute(hash: string): Route {
  const [first, encoded, tab, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const id = decoded(encoded);
  if (first !== 'projects' || !id || rest.length) return { page: 'home' };
  if (tab === undefined) return { page: 'project', id, tab: 'parts' };
  if (!TABS.includes(tab as Tab)) return { page: 'home' };
  return { page: 'project', id, tab: tab as Tab };
}

/** A part of the hash decoded, or undefined when it does not decode. */
function decoded(part: string | undefined) {
  try {
    return part && decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** The location hash of a route, for links. */
export function href(route: Route): string {
  if (route.page === 'home') return '#/';
  return `#/projects/${encodeURIComponent(route.id)}/${route.tab}`;
}

/** Goes to a route; `replace` takes the place of the current entry in the history. */
export function go(route: Route, { replace = false } = {}) {
  if (replace) location.replace(href(route));
  else location.hash = href(route);
}

/** The current route, following the location hash. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const changed = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route;
}
