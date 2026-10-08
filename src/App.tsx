import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/error-boundary";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import ConsoleLayout from "@/pages/ConsoleLayout";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ProvidersPage = lazy(() => import("@/pages/ProvidersPage"));
const KeysPage = lazy(() => import("@/pages/KeysPage"));
const PoliciesPage = lazy(() => import("@/pages/PoliciesPage"));
const LogsPage = lazy(() => import("@/pages/LogsPage"));
const PlaygroundPage = lazy(() => import("@/pages/PlaygroundPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="size-6 text-primary animate-spin" aria-label="加载中" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, ready } = useAuth();
  if (!ready) return <FullScreenLoader />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HashRouter>
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route
                element={
                  <Protected>
                    <ConsoleLayout />
                  </Protected>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/keys" element={<KeysPage />} />
                <Route path="/policies" element={<PoliciesPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
        <Toaster theme="dark" position="top-right" />
      </AuthProvider>
    </ErrorBoundary>
  );
}
