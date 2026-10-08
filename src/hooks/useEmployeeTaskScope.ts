import { useCallback, useEffect, useState } from 'react';
import {
  readEmployeeTaskScope,
  writeEmployeeTaskScope,
  type EmployeeTaskScope,
} from '../lib/employeeTaskScope';

export function useEmployeeTaskScope(employeeName: string) {
  const [scope, setScopeState] = useState<EmployeeTaskScope>(() =>
    readEmployeeTaskScope(employeeName),
  );

  useEffect(() => {
    setScopeState(readEmployeeTaskScope(employeeName));
  }, [employeeName]);

  const setScope = useCallback(
    (next: EmployeeTaskScope) => {
      writeEmployeeTaskScope(employeeName, next);
      setScopeState(next);
    },
    [employeeName],
  );

  return { scope, setScope };
}
