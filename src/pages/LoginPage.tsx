import { useEffect, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck, Zap, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setError("");
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
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
            <h2 className="text-2xl font-semibold tracking-tight">控制台登录</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              演示账号 <span className="font-mono text-foreground">admin</span> /{" "}
              <span className="font-mono text-foreground">admin123</span>
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
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
                    autoComplete="current-password"
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

              {error && (
                <p role="alert" className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "验证中…" : "登录控制台"}
              </Button>
            </form>

            <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
              密码使用 PBKDF2-SHA256（10 万次迭代）校验，会话为 HMAC 签名的 12
              小时短时令牌。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
