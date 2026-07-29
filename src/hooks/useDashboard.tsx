import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadDashboardData } from '../lib/loadData';
import type { DashboardData } from '../lib/types';

type Ctx = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
};

const DataContext = createContext<Ctx>({ data: null, loading: true, error: null });

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDashboardData()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message || 'Failed to load data');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DataContext.Provider value={{ data, loading, error }}>{children}</DataContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DataContext);
}
