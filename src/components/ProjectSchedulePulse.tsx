import { useEffect, useState } from 'react';
import { loadProjectSchedule } from '../lib/loadProjectSchedule';
import { buildDeadlineEvents, startOfDay } from '../lib/scheduleDates';
import { supabase } from '../lib/supabase';

/** Compact next-deadline / meetings chip for employee project lists. */
export function ProjectSchedulePulse({ projectKey }: { projectKey: string }) {
  const [label, setLabel] = useState('…');
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ rows }, meetings] = await Promise.all([
        loadProjectSchedule(projectKey),
        supabase
          .from('pa_client_meetings')
          .select('id, meeting_at')
          .eq('project_key', projectKey)
          .gte('meeting_at', new Date().toISOString())
          .order('meeting_at', { ascending: true })
          .limit(1),
      ]);
      if (cancelled) return;

      const events = buildDeadlineEvents(rows).filter((e) => e.kind !== 'phase');
      const today = startOfDay(new Date()).getTime();
      const overdue = events.filter(
        (e) => e.date.getTime() < today && !/completed|n\/a/i.test(e.status),
      ).length;
      const next = events.find((e) => e.date.getTime() >= today);
      const nextMeeting = (meetings.data || [])[0] as { meeting_at: string } | undefined;

      if (overdue) {
        setWarn(true);
        setLabel(`${overdue} past due`);
        return;
      }
      if (next) {
        setWarn(false);
        setLabel(`Next ${next.dateKey}`);
        return;
      }
      if (nextMeeting) {
        setWarn(false);
        const d = new Date(nextMeeting.meeting_at);
        setLabel(
          `Meet ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
        );
        return;
      }
      setWarn(false);
      setLabel(rows.length ? 'No dates' : 'No schedule');
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  return <span className={`emp-pulse mono${warn ? ' warn' : ''}`}>{label}</span>;
}
