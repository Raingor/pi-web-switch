import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SessionsPage } from "@/components/sessions/SessionsPage";
import { MemoryPage } from "@/components/sessions/MemoryPage";
import { ProvidersModelsPage } from "@/components/providers/ProvidersModelsPage";
import { SubagentsPage } from "@/components/subagents/SubagentsPage";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { ModelSpeedTestPage } from "@/components/speedtest/ModelSpeedTestPage";
import { ChatPage } from "@/components/chat/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/providers" element={<ProvidersModelsPage />} />
          <Route path="/models" element={<ProvidersModelsPage />} />
          <Route path="/subagents" element={<SubagentsPage />} />
          <Route path="/settings" element={<SettingsWorkspace />} />
          <Route path="/speed-test" element={<ModelSpeedTestPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
