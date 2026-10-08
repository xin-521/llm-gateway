import { Suspense } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  KeyRound,
  ShieldAlert,
  ScrollText,
  Play,
  Zap,
  LogOut,
  Loader2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import ErrorBoundary from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true },
  { to: "/providers", label: "模型供应商", icon: Server },
  { to: "/keys", label: "API 密钥", icon: KeyRound },
  { to: "/policies", label: "安全与路由策略", icon: ShieldAlert },
  { to: "/logs", label: "请求日志", icon: ScrollText },
  { to: "/playground", label: "Playground", icon: Play },
];

export default function ConsoleLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <SidebarProvider className="min-h-screen">
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="h-14 flex flex-row items-center gap-2.5 px-3">
          <div className="size-8 rounded-lg bg-primary grid place-items-center shrink-0">
            <Zap className="size-4 text-primary-foreground" />
          </div>
          <div className="group-data-[collapsible=icon]:hidden leading-tight">
            <p className="font-semibold text-sm tracking-tight">LLM Gateway</p>
            <p className="text-[11px] text-muted-foreground font-mono">edge console</p>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>控制台</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn("flex items-center gap-2.5", isActive && "bg-sidebar-accent text-sidebar-accent-foreground font-medium")
                        }
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
            <div className="size-8 rounded-full bg-secondary grid place-items-center text-xs font-semibold shrink-0">
              {user?.name?.slice(0, 1) ?? "A"}
            </div>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="text-sm truncate">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                {user?.username} · {user?.role}
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              aria-label="退出登录"
              title="退出登录"
              className="text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:hidden"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="h-14 shrink-0 flex items-center gap-3 border-b border-border px-4 lg:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5 !bg-border" />
          <p className="text-sm text-muted-foreground">
            网关端点：
            <span className="font-mono text-foreground">POST /api/v1/chat/completions</span>
            <span className="mx-2 opacity-40">·</span>
            <span className="font-mono text-foreground">POST /api/v1/messages</span>
          </p>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="h-full grid place-items-center">
                <div className="text-center space-y-3">
                  <p className="text-sm text-muted-foreground">页面加载失败：{error.message}</p>
                  <button onClick={reset} className="text-sm text-primary hover:underline">
                    重新加载
                  </button>
                </div>
              </div>
            )}
          >
            <Suspense
              fallback={
                <div className="h-64 grid place-items-center">
                  <Loader2 className="size-6 text-primary animate-spin" aria-label="加载中" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
