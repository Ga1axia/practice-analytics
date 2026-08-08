import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { DemoModeProvider } from './hooks/useDemoMode';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/demo/*"
          element={
            <DemoModeProvider isDemo>
              <App />
            </DemoModeProvider>
          }
        />
        <Route
          path="/*"
          element={
            <DemoModeProvider isDemo={false}>
              <App />
            </DemoModeProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
