import type { ProjectDocument } from '../../src/project/model';

/** A project that nests into its strip; a new one nests into sheets. */
export const onStrip = (project: ProjectDocument): ProjectDocument => ({
  ...project,
  stock: { ...project.stock, packing: 'strip' },
});
