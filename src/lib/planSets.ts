export type PlanSetLink = {
  id: string;
  label: string;
  description: string;
  url: string;
  updatedLabel: string;
};

const EXAMPLE_BOX =
  'https://mdesignarchitects.app.box.com/s/5rxrgj9n984qtqoojtv1ih4xbb4s50hw';

/**
 * Plan-set Box folders for staff (admin + employee).
 * Uses a shared Box folder until per-project folders are wired to data.
 */
export function planSetsForProject(projectKey: string, projectTitle: string): PlanSetLink[] {
  void projectKey;
  return [
    {
      id: 'current-set',
      label: 'Current plan set',
      description: `${projectTitle} — latest drawings on Box.`,
      url: EXAMPLE_BOX,
      updatedLabel: 'Shared folder',
    },
    {
      id: 'archive-set',
      label: 'Prior / archive set',
      description: 'Earlier issued sheets for reference.',
      url: EXAMPLE_BOX,
      updatedLabel: 'Shared folder',
    },
  ];
}
