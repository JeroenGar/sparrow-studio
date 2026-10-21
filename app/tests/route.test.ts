import { describe, expect, it } from 'vitest';
import { PROJECTS, href, parseRoute, type Route } from '../src/ui/route';

describe('routes', () => {
  it('round-trips through the location hash, and anything unknown is the projects', () => {
    const routes: Route[] = [
      PROJECTS,
      { page: 'project', id: 'prj_1', tab: 'parts' },
      { page: 'project', id: 'a/b', tab: 'jobs' },
      { page: 'job', id: 'prj_1', number: 12, view: 'layout' },
      { page: 'job', id: 'prj_1', number: 3, view: 'inputs' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
    expect(parseRoute('')).toEqual(PROJECTS);
    expect(parseRoute('#/jobs')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/prj_1')).toEqual({ page: 'project', id: 'prj_1', tab: 'parts' });
    expect(parseRoute('#/projects/prj_1/elsewhere')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/prj_1/parts/more')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/%/parts')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/prj_1/jobs/0')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/prj_1/parts/3')).toEqual(PROJECTS);
    expect(parseRoute('#/projects/prj_1/jobs/3/other')).toEqual(PROJECTS);
  });
});
