import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Box,
  Plug,
  Settings,
  Pi,
  History,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/models", icon: Box, label: "Models" },
  { to: "/providers", icon: Plug, label: "Providers" },
  { to: "/sessions", icon: History, label: "Sessions" },
  { to: "/memory", icon: Brain, label: "Memory" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside
      className="flex h-screen w-64 flex-col border-r"
      style={{
        backgroundColor: "var(--sidebar-bg)",
        borderColor: "var(--sidebar-border)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 border-b px-6 py-5"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--sidebar-logo)" }}>
          <Pi className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold" style={{ color: "var(--page-text)" }}>pi-switch</h1>
          <p className="text-xs" style={{ color: "var(--subtle-text)" }}>Configuration Manager</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              )
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? "var(--sidebar-active-bg)" : "transparent",
              color: isActive ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
            })}
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="border-t px-6 py-4"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <p className="text-xs" style={{ color: "var(--subtle-text)" }}>pi-switch v0.1.0</p>
      </div>
    </aside>
  );
}