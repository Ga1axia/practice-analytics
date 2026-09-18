import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapCoreProjects } from './bqeSyncBuild';
import type { BqeProject } from './bqe';
import {
  emptyRecentHoursIndex,
  extractJobCode,
  hoursCutoffIso,
  mergeBqeTimeEntriesIntoHoursIndex,
  planInactiveStatusUpdates,
  PROJECT_LIBRARY_HOURS_YEARS,
  projectKeysMatchingHoursIndex,
  selectMappedProjectsForLibrary,
  type ProjectStatusRow,
} from './projectHoursFilter';

function proj(partial: Partial<BqeProject> & Pick<BqeProject, 'id'>): BqeProject {
  return { name: partial.name || partial.id, ...partial };
}

describe('project library hours window', () => {
  it('defaults to 2 years', () => {
    assert.equal(PROJECT_LIBRARY_HOURS_YEARS, 2);
    const two = hoursCutoffIso(2);
    const three = hoursCutoffIso(3);
    assert.equal(two.slice(0, 4), String(new Date().getUTCFullYear() - 2));
    assert.ok(two > three);
  });

  it('extracts job codes', () => {
    assert.equal(extractJobCode('21-100 Main Street'), '21-100');
    assert.equal(extractJobCode('no code'), null);
  });
});

describe('selectMappedProjectsForLibrary', () => {
  const sinceIso = '2024-01-01';

  it('initial library keeps recent-hours and recently created jobs', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'recent', name: '21-100 Recent', createdOn: '2016-05-01' }),
      proj({ id: 'newish', name: '25-010 Brand New', createdOn: '2025-03-01' }),
      proj({ id: 'ancient', name: '10-001 Ancient', createdOn: '2012-01-01' }),
    ]);
    const hours = emptyRecentHoursIndex();
    mergeBqeTimeEntriesIntoHoursIndex(
      hours,
      [{ projectId: 'recent', project: '21-100 Recent', actualHours: 8, date: '2025-06-01' }],
      sinceIso,
    );
    const selected = selectMappedProjectsForLibrary(mapped, {
      existingKeys: new Set(),
      hoursIndex: hours,
      sinceIso,
    });
    const names = selected.mapped.rows.map((r) => r.project).sort();
    assert.equal(selected.mode, 'initial');
    assert.deepEqual(names, ['21-100 Recent', '25-010 Brand New']);
  });

  it('after the library exists, only adds new jobs — not older CORE projects', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'lib', name: '21-100 Library', createdOn: '2016-05-01' }),
      proj({ id: 'old', name: '10-001 Ancient', createdOn: '2012-01-01' }),
      proj({ id: 'fresh', name: '26-040 Fresh', createdOn: '2026-02-01' }),
    ]);
    const hours = emptyRecentHoursIndex();
    mergeBqeTimeEntriesIntoHoursIndex(
      hours,
      [
        { projectId: 'lib', project: '21-100 Library', actualHours: 4, date: '2025-01-01' },
        { projectId: 'old', project: '10-001 Ancient', actualHours: 4, date: '2025-01-01' },
      ],
      sinceIso,
    );
    const selected = selectMappedProjectsForLibrary(mapped, {
      existingKeys: new Set(['21-100 Library']),
      hoursIndex: hours,
      sinceIso,
      includeExistingLibraryRows: false,
    });
    const names = selected.mapped.rows.map((r) => r.project).sort();
    assert.equal(selected.mode, 'additive');
    assert.deepEqual(names, ['26-040 Fresh']);
    assert.equal(selected.addedRoots, 1);
    assert.ok(!names.includes('10-001 Ancient'));
    assert.ok(!names.includes('21-100 Library'));
  });

  it('adds a new phase under an existing library project', () => {
    const mapped = mapCoreProjects([
      proj({ id: 'lib', name: '21-100 Library', createdOn: '2016-05-01' }),
      proj({
        id: 'ph',
        name: '21-100 Library',
        parentId: 'lib',
        phaseName: 'CA',
        phaseDescription: 'Construction Admin',
        createdOn: '2016-05-01',
      }),
    ]);
    const selected = selectMappedProjectsForLibrary(mapped, {
      existingKeys: new Set(['21-100 Library']),
      hoursIndex: emptyRecentHoursIndex(),
      sinceIso,
      includeExistingLibraryRows: false,
    });
    assert.equal(selected.mapped.rows.length, 1);
    assert.equal(selected.mapped.rows[0]?.parent_project, '21-100 Library');
    assert.match(selected.mapped.rows[0]?.project || '', /Construction Admin/);
  });
});

describe('planInactiveStatusUpdates', () => {
  it('marks stale-hour projects inactive and restores ones with recent hours', () => {
    const projects: ProjectStatusRow[] = [
      { project: '21-100 Live', row_kind: 'project', parent_project: null, status: 'ACTIVE' },
      { project: '18-050 Quiet', row_kind: 'project', parent_project: null, status: 'ACTIVE' },
      { project: '24-001 New', row_kind: 'project', parent_project: null, status: 'ACTIVE' },
      { project: '19-200 Back', row_kind: 'project', parent_project: null, status: 'INACTIVE' },
    ];
    const recent = emptyRecentHoursIndex();
    recent.codes.add('21-100');
    recent.codes.add('19-200');
    const stale = emptyRecentHoursIndex();
    stale.codes.add('18-050');
    stale.codes.add('19-200');

    const plan = planInactiveStatusUpdates(projects, recent, stale);
    assert.deepEqual(plan.markInactive.sort(), ['18-050 Quiet', '24-001 New']);
    assert.deepEqual(plan.restoreActive.sort(), ['19-200 Back']);
  });

  it('marks projects that never had hours inactive', () => {
    const projects: ProjectStatusRow[] = [
      { project: '26-001 Empty', row_kind: 'project', parent_project: null, status: 'ACTIVE' },
    ];
    const plan = planInactiveStatusUpdates(
      projects,
      emptyRecentHoursIndex(),
      emptyRecentHoursIndex(),
    );
    assert.deepEqual(plan.markInactive, ['26-001 Empty']);
    assert.deepEqual(plan.restoreActive, []);
  });

  it('leaves completed jobs without hours completed', () => {
    const projects: ProjectStatusRow[] = [
      { project: '12-010 Done', row_kind: 'project', parent_project: null, status: 'COMPLETED' },
    ];
    const plan = planInactiveStatusUpdates(
      projects,
      emptyRecentHoursIndex(),
      emptyRecentHoursIndex(),
    );
    assert.deepEqual(plan.markInactive, []);
    assert.deepEqual(plan.restoreActive, []);
  });
});

describe('hours index matches CORE names without job codes', () => {
  it('keeps a library header active when TEs only have parent/phase labels', () => {
    const recent = emptyRecentHoursIndex();
    mergeBqeTimeEntriesIntoHoursIndex(
      recent,
      [
        {
          project: 'Krishnan Sivaram - Construction Support',
          actualHours: 0.25,
          date: '2026-09-01',
        },
        {
          project: 'Internal Office  - PTO',
          activity: 'Sick Time:',
          actualHours: 8,
          date: '2026-09-01',
        },
      ],
      '2024-09-18',
    );
    const projects: ProjectStatusRow[] = [
      {
        project: 'Krishnan Sivaram - 24-076',
        row_kind: 'project',
        parent_project: null,
        status: 'ACTIVE',
      },
    ];
    const keep = projectKeysMatchingHoursIndex(projects, recent);
    assert.equal(keep.has('Krishnan Sivaram - 24-076'), true);
    const plan = planInactiveStatusUpdates(projects, recent, emptyRecentHoursIndex());
    assert.deepEqual(plan.markInactive, []);
  });

  it('does not treat PTO or sick as project hours', () => {
    const recent = emptyRecentHoursIndex();
    mergeBqeTimeEntriesIntoHoursIndex(
      recent,
      [
        {
          project: 'Krishnan Sivaram - Construction Support',
          activity: 'Sick Time:',
          actualHours: 8,
          date: '2026-09-01',
        },
        {
          project: 'Internal Office  - PTO',
          activity: 'Vacation:',
          actualHours: 8,
          date: '2026-09-01',
        },
      ],
      '2024-09-18',
    );
    const projects: ProjectStatusRow[] = [
      {
        project: 'Krishnan Sivaram - 24-076',
        row_kind: 'project',
        parent_project: null,
        status: 'ACTIVE',
      },
    ];
    const keep = projectKeysMatchingHoursIndex(projects, recent);
    assert.equal(keep.has('Krishnan Sivaram - 24-076'), false);
  });
});
