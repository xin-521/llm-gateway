import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Zap, EyeOff, Eye, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api";

interface BootstrapStatus {
  initialized: boolean;
}

export default function LoginPage() {
  const { login, setup } = useAuth();
  const { data: status, isLoading } = useQuery({
    queryKey: ["bootstrap-status"],
    queryFn: () => api.get<BootstrapStatus>("/status"),
    staleTime: 0,
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const firstRun = status ? !status.initialized : false;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (firstRun) {
      if (username.trim().length < 3) return setError("用户名至少 3 个字符");
      if (password.length < 8) return setError("密码至少 8 位");
      if (password !== confirm) return setError("两次输入的密码不一致");
    }
    setBusy(true);
    try {
      if (firstRun) await setup(username.trim(), password);
      else await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法连接网关服务，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background relative overflow-hidden">
      {/* ambient grid backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(222 18% 17%) 1px, transparent 1px), linear-gradient(90deg, hsl(222 18% 17%) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)",
        }}
      />

      {/* left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 border-r border-border">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-primary grid place-items-center">
            <Zap className="size-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight">LLM Gateway</span>
        </div>

        <div className="max-w-md animate-fade-up">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            一个端点，
            <br />
            接入<span className="text-primary">所有大模型</span>。
          </h1>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            OpenAI 与 Anthropic 双协议兼容 · 自动故障转移 · 提示词注入防护 ·
            统一 API 密钥管理。
          </p>
          <div className="mt-8 space-y-3 text-sm">
            {[
              { icon: ShieldCheck, text: "请求级注入扫描：拦截 / 净化 / 告警三种策略" },
              { icon: Zap, text: "优先级路由 + 熔断冷却，秒级切换到备用供应商" },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-3 text-muted-foreground">
                <f.icon className="size-4 text-primary shrink-0" />
                {f.text}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground/70 font-mono">
          ESA Edge Routine · edge-native inference routing
        </p>
      </div>

      {/* right form panel */}
      <div className="relative flex items-center justify-center p-6">
        <Card className="w-full max-w-sm animate-fade-up">
          <CardContent className="pt-8">
            <div className="lg:hidden flex items-center gap-2 mb-6">
              <div className="size-8 rounded-lg bg-primary grid place-items-center">
                <Zap className="size-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">LLM Gateway</span>
            </div>

            {isLoading ? (
              <div className="h-64 grid place-items-center">
                <Loader2 className="size-5 text-primary animate-spin" aria-label="加载中" />
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {firstRun ? "初始化管理员" : "控制台登录"}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {firstRun
                    ? "首次使用，请设置管理员账号与密码。"
                    : "输入管理员账号以进入控制台。"}
                </p>

                <form onSubmit={onSubmit} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">用户名</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      placeholder={firstRun ? "至少 3 个字符" : ""}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">密码</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPw ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={firstRun ? "new-password" : "current-password"}
                        placeholder={firstRun ? "至少 8 位" : ""}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        aria-label={showPw ? "隐藏密码" : "显示密码"}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  {firstRun && (
                    <div className="space-y-2">
                      <Label htmlFor="confirm">确认密码</Label>
                      <Input
                        id="confirm"
                        type={showPw ? "text" : "password"}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                    </div>
                  )}

                  {error && (
                    <p
                      role="alert"
                      className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2"
                    >
                      {error}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : firstRun ? (
                      <UserPlus className="size-4" />
                    ) : null}
                    {busy ? "请稍候…" : firstRun ? "创建并进入控制台" : "登录控制台"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
