export type ScheduleRowKind = 'phase' | 'task' | 'subtask';

export type ScheduleMeta = {
  id: string;
  project_key: string;
  client_name: string;
  title: string;
};

export type ScheduleRow = {
  id: string;
  schedule_id: string;
  sort_order: number;
  row_kind: ScheduleRowKind;
  task: string;
  budget_remaining: string;
  target_start: string;
  target_end: string;
  actual_start: string;
  actual_end: string;
  action: string;
  estimate_time: string;
  mdesigns_comments: string;
  client_comments: string;
};

export type ScheduleField = keyof Pick<
  ScheduleRow,
  | 'task'
  | 'budget_remaining'
  | 'target_start'
  | 'target_end'
  | 'actual_start'
  | 'actual_end'
  | 'action'
  | 'estimate_time'
  | 'mdesigns_comments'
  | 'client_comments'
>;
