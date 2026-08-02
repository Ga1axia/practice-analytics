import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { loadDashboardData } from '../lib/loadData';
import type { DashboardData } from '../lib/types';

type Ctx = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const DataContext = createContext<Ctx>({
  data: null,
  loading: true,
  error: null,
  reload: async () => undefined,
});

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await loadDashboardData();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <DataContext.Provider value={{ data, loading, error, reload }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DataContext);
}
