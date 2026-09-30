import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";

const DashboardPage = lazy(() => import("@/components/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SessionsPage = lazy(() => import("@/components/sessions/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const MemoryPage = lazy(() => import("@/components/sessions/MemoryPage").then((m) => ({ default: m.MemoryPage })));
const ProvidersModelsPage = lazy(() => import("@/components/providers/ProvidersModelsPage").then((m) => ({ default: m.ProvidersModelsPage })));
const SubagentsPage = lazy(() => import("@/components/subagents/SubagentsPage").then((m) => ({ default: m.SubagentsPage })));
const SettingsPage = lazy(() => import("@/components/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ModelSpeedTestPage = lazy(() => import("@/components/speedtest/ModelSpeedTestPage").then((m) => ({ default: m.ModelSpeedTestPage })));
const GeneratePage = lazy(() => import("@/components/generate/GeneratePage").then((m) => ({ default: m.GeneratePage })));

function PageFallback() {
  return (
    <div className="loading-console" role="status" aria-live="polite" aria-label="Loading">
      <div className="loading-core">
        <div className="loading-ring" />
        <span>LOADING</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/providers" element={<ProvidersModelsPage />} />
          <Route path="/models" element={<ProvidersModelsPage />} />
          <Route path="/subagents" element={<SubagentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/speed-test" element={<ModelSpeedTestPage />} />
          <Route path="/generate" element={<GeneratePage />} />
        </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
