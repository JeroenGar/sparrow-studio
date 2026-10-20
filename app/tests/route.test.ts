import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/ui/route';

describe('routes', () => {
  it('round-trips through the location hash, and anything unknown is home', () => {
    const routes: Route[] = [
      { page: 'home' },
      { page: 'project', id: 'prj_1', tab: 'parts' },
      { page: 'project', id: 'a/b', tab: 'solution' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#/projects/prj_1')).toEqual({ page: 'project', id: 'prj_1', tab: 'parts' });
    expect(parseRoute('#/projects/prj_1/elsewhere')).toEqual({ page: 'home' });
    expect(parseRoute('#/projects/prj_1/parts/more')).toEqual({ page: 'home' });
    expect(parseRoute('#/projects/%/parts')).toEqual({ page: 'home' });
  });
});
