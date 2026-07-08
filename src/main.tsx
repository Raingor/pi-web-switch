import { useEffect } from "react";
import { useConfigStore } from "@/store/config-store";
import App from "@/App";
import "@/index.css";

function InitGate({ children }: { children: React.ReactNode }) {
  const initialized = useConfigStore((s) => s.initialized);
  const init = useConfigStore((s) => s.init);
  const config = useConfigStore((s) => s.config);

  useEffect(() => {
    init();
  }, [init]);

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          <p className="text-sm text-gray-500">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function Root() {
  return (
    <InitGate>
      <App />
    </InitGate>
  );
}