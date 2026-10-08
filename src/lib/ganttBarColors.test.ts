import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ganttBarBackground } from './ganttBarColors';

describe('ganttBarBackground', () => {
  it('varies base color by palette index', () => {
    const a = ganttBarBackground({ tone: 'active', kind: 'task', paletteIndex: 0 });
    const b = ganttBarBackground({ tone: 'active', kind: 'task', paletteIndex: 1 });
    assert.notEqual(a.background, b.background);
  });

  it('lightens subtasks vs tasks', () => {
    const task = ganttBarBackground({ tone: 'active', kind: 'task', paletteIndex: 2 });
    const sub = ganttBarBackground({ tone: 'active', kind: 'subtask', paletteIndex: 2 });
    assert.notEqual(task.background, sub.background);
  });
});
