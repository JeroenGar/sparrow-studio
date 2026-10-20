import { useEffect, useState } from 'react';
import type { Tab } from './context';

/** What a job's page shows: its layout, live or final, or the inputs it ran with. */
export type JobView = 'layout' | 'inputs';

/** Where studio is: home, a tab of a project, or one of its jobs. */
export type Route =
  | { page: 'home' }
  | { page: 'project'; id: string; tab: Tab }
  | { page: 'job'; id: string; number: number; view: JobView };

const TABS: Tab[] = ['parts', 'sheets', 'machine', 'settings', 'jobs'];

/** The route of a location hash, such as `#/projects/<id>/jobs/3`; anything else is home. */
export function parseRoute(hash: string): Route {
  const [first, encoded, tab, number, view, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const home: Route = { page: 'home' };
  const id = decoded(encoded);
  if (first !== 'projects' || !id || rest.length) return home;
  if (tab === undefined) return { page: 'project', id, tab: 'parts' };
  if (!TABS.includes(tab as Tab)) return home;
  if (number === undefined)
    return view === undefined ? { page: 'project', id, tab: tab as Tab } : home;
  if (tab !== 'jobs' || !/^[1-9]\d*$/.test(number)) return home;
  if (view !== undefined && view !== 'inputs') return home;
  return { page: 'job', id, number: Number(number), view: view ?? 'layout' };
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
  const project = `#/projects/${encodeURIComponent(route.id)}`;
  if (route.page === 'project') return `${project}/${route.tab}`;
  return `${project}/jobs/${route.number}${route.view === 'inputs' ? '/inputs' : ''}`;
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
