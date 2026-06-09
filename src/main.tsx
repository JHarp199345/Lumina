import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { diagnosticError, installDiagnostics } from "./utils/diagnostics";

installDiagnostics();

class LuminaCrashBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    diagnosticError("react.render_crash", error.message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#03101d] p-6 text-sky-50">
        <div className="w-[min(560px,100%)] rounded-xl border border-sky-200/16 bg-[#071525] p-5 shadow-2xl">
          <p className="text-sm font-semibold text-sky-50/80">Lumina hit a display break.</p>
          <p className="mt-2 text-xs leading-relaxed text-sky-100/40">
            The reader is still here, but one screen failed to render. Reloading usually clears this
            after an update; the error below tells us what broke.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-sky-100/10 bg-black/25 p-3 text-[11px] leading-relaxed text-sky-100/45">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-sky-100/14 bg-sky-100/6 px-3 py-2 text-xs text-sky-50/65 transition-colors hover:bg-sky-100/10 hover:text-sky-50"
          >
            Reload Lumina
          </button>
        </div>
      </div>
    );
  }
}

// ─── Service Worker (PWA / web runtime only) ──────────────────────────────────
// Register the SW so Lumina can be installed and used offline on tablets.
// We skip registration inside Tauri — the native shell handles app delivery.

const isTauri =
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
  "undefined";

if (!isTauri && import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => {
        if (registration.scope.includes(window.location.origin)) {
          registration.unregister().catch(() => {});
        }
      });
    })
    .catch(() => {});

  if ("caches" in window) {
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("lumina-")).map((key) => caches.delete(key)))
      )
      .catch(() => {});
  }
}

if (!isTauri && import.meta.env.PROD && "serviceWorker" in navigator) {
  const SW_BUILD = "v4";
  let refreshing = false;
  let activeRegistration: ServiceWorkerRegistration | null = null;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const checkForUpdates = () => {
    activeRegistration?.update().catch(() => {});
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?build=${SW_BUILD}`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .then((reg) => {
        activeRegistration = reg;
        console.info("[SW] Registered:", reg.scope);
        checkForUpdates();
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
  });

  window.addEventListener("focus", checkForUpdates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdates();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LuminaCrashBoundary>
      <App />
    </LuminaCrashBoundary>
  </React.StrictMode>
);
