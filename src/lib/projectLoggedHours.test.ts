import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTimeEntryProjectIndex,
  isPtoOrSickTimeEntry,
  projectKeysForTimeEntry,
  stripJobCodes,
  timeEntryMatchesProject,
} from './projectHoursMatch';

describe('isPtoOrSickTimeEntry', () => {
  it('flags Internal Office PTO / sick / holiday / vacation', () => {
    assert.equal(
      isPtoOrSickTimeEntry({
        parent_project_name: 'Internal Office',
        project_name: 'Internal Office  - PTO',
        activity: 'Sick Time:',
        phase: 'PTO',
      }),
      true,
    );
    assert.equal(
      isPtoOrSickTimeEntry({
        parent_project_name: 'Internal Office',
        project_name: 'Internal Office  - PTO',
        activity: 'Vacation:',
      }),
      true,
    );
  });

  it('does not flag client project hours or lunch', () => {
    assert.equal(
      isPtoOrSickTimeEntry({
        parent_project_name: 'Krishnan Sivaram',
        project_name: 'Krishnan Sivaram - Construction Support',
        activity: 'Construction Coordination:',
      }),
      false,
    );
    assert.equal(
      isPtoOrSickTimeEntry({
        parent_project_name: 'Internal Office',
        project_name: 'Internal Office  - Lunch Time',
        activity: 'Lunch:',
        phase: 'Lunch Time',
      }),
      false,
    );
  });
});

describe('stripJobCodes', () => {
  it('removes trailing job codes from library keys', () => {
    assert.equal(stripJobCodes('Balakrishnan Nikil - 22-052'), 'Balakrishnan Nikil');
    assert.equal(stripJobCodes('Wendy & Ben Tessone - 25-009'), 'Wendy & Ben Tessone');
  });
});

describe('timeEntryMatchesProject', () => {
  it('matches CORE labels that omit the job code', () => {
    const row = {
      parent_project_name: 'Krishnan Sivaram',
      project_name: 'Krishnan Sivaram - Construction Support',
    };
    assert.equal(
      timeEntryMatchesProject(row, {
        title: 'Krishnan Sivaram',
        fullName: 'Krishnan Sivaram - 24-076',
        code: '24-076',
      }),
      true,
    );
  });
});

describe('projectKeysForTimeEntry', () => {
  it('maps uncoded CORE names onto library keys', () => {
    const index = buildTimeEntryProjectIndex([
      { key: 'Krishnan Sivaram - 24-076', title: 'Krishnan Sivaram', code: '24-076' },
      { key: 'MDD RE Fund VIII LLC - 26-033', title: 'MDD RE Fund VIII LLC', code: '26-033' },
      { key: 'MDD RE Fund VIII LLC - 26-031', title: 'MDD RE Fund VIII LLC', code: '26-031' },
    ]);
    const sivaram = projectKeysForTimeEntry(
      {
        parent_project_name: 'Krishnan Sivaram',
        project_name: 'Krishnan Sivaram - Construction Support',
      },
      index,
    );
    assert.deepEqual(sivaram, ['Krishnan Sivaram - 24-076']);

    const mdd = projectKeysForTimeEntry(
      {
        parent_project_name: 'MDD RE Fund VIII LLC',
        project_name: 'MDD RE Fund VIII LLC - Planning Package',
      },
      index,
    );
    assert.deepEqual(mdd.sort(), [
      'MDD RE Fund VIII LLC - 26-031',
      'MDD RE Fund VIII LLC - 26-033',
    ]);
  });
});
