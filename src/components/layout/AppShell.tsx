import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu, RadioTower } from "lucide-react";
import { BasicSidebar } from "./BasicSidebar";
import { HelpButton } from "@/components/help/HelpButton";

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="app-atmosphere" aria-hidden="true">
        <span className="app-orbit app-orbit-one" />
        <span className="app-orbit app-orbit-two" />
        <span className="app-scanline" />
      </div>

      <BasicSidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {mobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-scrim"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <div className="app-stage">
        <header className="mobile-command-bar">
          <button
            className="command-icon-button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="mobile-brand">
            <RadioTower className="h-4 w-4" />
            <span>PI // CONTROL</span>
          </div>
          <span className="system-pulse" aria-hidden="true" />
        </header>

        <main className="app-main">
          <div className="app-canvas">
            <Outlet />
          </div>
        </main>
      </div>

      <HelpButton />
    </div>
  );
}
