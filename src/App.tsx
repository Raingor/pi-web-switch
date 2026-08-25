import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { ProvidersModelsPage } from "@/components/providers/ProvidersModelsPage";
import { SubagentsPage } from "@/components/subagents/SubagentsPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { ModelSpeedTestPage } from "@/components/speedtest/ModelSpeedTestPage";

export default function App() {
  return (
    <BrowserRouter>
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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}