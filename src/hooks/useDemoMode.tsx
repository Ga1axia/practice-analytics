import { createContext, useContext, useEffect, type ReactNode } from 'react';

const DemoModeContext = createContext(false);

export function DemoModeProvider({
  isDemo,
  children,
}: {
  isDemo: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = isDemo
      ? 'M·Designs Architects — Practice Analytics (Demo)'
      : 'M·Designs Architects — Practice Analytics';
  }, [isDemo]);

  return <DemoModeContext.Provider value={isDemo}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}
