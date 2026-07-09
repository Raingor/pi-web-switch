import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { ModelsPage } from "@/components/models/ModelsPage";
import { ProvidersPage } from "@/components/providers/ProvidersPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { SettingsPage } from "@/components/settings/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}