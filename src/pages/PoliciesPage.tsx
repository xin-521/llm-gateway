import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldAlert, Route, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Policies } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const RETRY_PRESETS = [408, 429, 500, 502, 503, 504];

export default function PoliciesPage() {
  const qc = useQueryClient();
  const { data: loaded } = useQuery({
    queryKey: ["policies"],
    queryFn: () => api.get<Policies>("/policies"),
  });
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [patternInput, setPatternInput] = useState("");

  useEffect(() => {
    if (loaded) setPolicies(loaded);
  }, [loaded]);

  const save = useMutation({
    mutationFn: (p: Policies) => api.put<Policies>("/policies", p),
    onSuccess: () => {
      toast.success("策略已生效");
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetHealth = useMutation({
    mutationFn: () => api.post("/reset-health", {}),
    onSuccess: () => {
      toast.success("熔断与健康计数已重置");
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  if (!policies) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  const patch = (fn: (p: Policies) => Policies) => setPolicies((p) => (p ? fn(p) : p));

  const addPattern = () => {
    const v = patternInput.trim();
    if (!v) return;
    try {
      new RegExp(v, "i");
    } catch {
      toast.error("正则表达式语法无效");
      return;
    }
    patch((p) => ({
      ...p,
      injection: { ...p.injection, patterns: [...p.injection.patterns, v] },
    }));
    setPatternInput("");
  };

  return (
    <div className="space-y-6 animate-fade-up max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">安全与路由策略</h1>
          <p className="text-sm text-muted-foreground mt-1">
            故障转移、熔断、提示词注入防护的全局配置，保存后即时生效。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => resetHealth.mutate()} disabled={resetHealth.isPending}>
            <RotateCcw className="size-4 mr-1.5" /> 重置熔断状态
          </Button>
          <Button onClick={() => save.mutate(policies)} disabled={save.isPending}>
            <Save className="size-4 mr-1.5" /> {save.isPending ? "保存中…" : "保存策略"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* failover */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Route className="size-4 text-primary" /> 自动故障转移
            </CardTitle>
            <CardDescription>
              请求按供应商优先级路由；上游失败或超时时自动切换下一供应商，连续失败触发熔断。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="f-attempts">最大尝试次数（1–6）</Label>
                <Input
                  id="f-attempts"
                  type="number"
                  min={1}
                  max={6}
                  value={policies.failover.maxAttempts}
                  onChange={(e) =>
                    patch((p) => ({
                      ...p,
                      failover: { ...p.failover, maxAttempts: Number(e.target.value) || 1 },
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-timeout">单上游超时（毫秒）</Label>
                <Input
                  id="f-timeout"
                  type="number"
                  min={1000}
                  step={1000}
                  value={policies.failover.timeoutMs}
                  onChange={(e) =>
                    patch((p) => ({
                      ...p,
                      failover: { ...p.failover, timeoutMs: Number(e.target.value) || 1000 },
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-threshold">熔断阈值（连续失败次数）</Label>
                <Input
                  id="f-threshold"
                  type="number"
                  min={1}
                  max={10}
                  value={policies.failover.circuitFailThreshold}
                  onChange={(e) =>
                    patch((p) => ({
                      ...p,
                      failover: {
                        ...p.failover,
                        circuitFailThreshold: Number(e.target.value) || 1,
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-cooldown">熔断冷却（毫秒）</Label>
                <Input
                  id="f-cooldown"
                  type="number"
                  min={1000}
                  step={1000}
                  value={policies.failover.circuitCooldownMs}
                  onChange={(e) =>
                    patch((p) => ({
                      ...p,
                      failover: { ...p.failover, circuitCooldownMs: Number(e.target.value) || 1000 },
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>触发转移的 HTTP 状态码</Label>
              <div className="flex flex-wrap gap-2">
                {RETRY_PRESETS.map((code) => {
                  const on = policies.failover.retryOnStatus.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() =>
                        patch((p) => ({
                          ...p,
                          failover: {
                            ...p.failover,
                            retryOnStatus: on
                              ? p.failover.retryOnStatus.filter((c) => c !== code)
                              : [...p.failover.retryOnStatus, code].sort((a, b) => a - b),
                          },
                        }))
                      }
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                      aria-pressed={on}
                    >
                      <Badge
                        variant={on ? "default" : "outline"}
                        className="font-mono cursor-pointer select-none"
                      >
                        {code}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* injection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="size-4 text-primary" /> 提示词注入防护
            </CardTitle>
            <CardDescription>
              扫描所有入站消息（含工具返回），匹配正则规则后可拦截、净化或仅告警。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <Label htmlFor="i-enabled">启用注入检测</Label>
              <Switch
                id="i-enabled"
                checked={policies.injection.enabled}
                onCheckedChange={(v) =>
                  patch((p) => ({ ...p, injection: { ...p.injection, enabled: !!v } }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>命中后的处置</Label>
              <Select
                value={policies.injection.action}
                onValueChange={(v) =>
                  patch((p) => ({
                    ...p,
                    injection: { ...p.injection, action: v as Policies["injection"]["action"] },
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sanitize">净化 — 转义注入片段后放行</SelectItem>
                  <SelectItem value="block">拦截 — 直接返回 400</SelectItem>
                  <SelectItem value="warn">告警 — 放行并记录日志</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-pattern">检测规则（正则表达式）</Label>
              <div className="flex gap-2">
                <Input
                  id="i-pattern"
                  value={patternInput}
                  onChange={(e) => setPatternInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPattern()}
                  placeholder="ignore (all|previous) instructions"
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={addPattern} aria-label="添加规则">
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {policies.injection.patterns.map((pat, i) => (
                  <div
                    key={`${pat}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5"
                  >
                    <code className="flex-1 text-xs font-mono break-all">{pat}</code>
                    <button
                      onClick={() =>
                        patch((p) => ({
                          ...p,
                          injection: {
                            ...p.injection,
                            patterns: p.injection.patterns.filter((_, j) => j !== i),
                          },
                        }))
                      }
                      aria-label={`删除规则 ${pat}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="i-tmpl">注入统一系统提示词</Label>
              <Switch
                id="i-tmpl"
                checked={policies.injection.systemTemplateEnabled}
                onCheckedChange={(v) =>
                  patch((p) => ({
                    ...p,
                    injection: { ...p.injection, systemTemplateEnabled: !!v },
                  }))
                }
              />
            </div>
            <Textarea
              value={policies.injection.systemTemplate}
              onChange={(e) =>
                patch((p) => ({
                  ...p,
                  injection: { ...p.injection, systemTemplate: e.target.value },
                }))
              }
              rows={3}
              className="text-sm"
              disabled={!policies.injection.systemTemplateEnabled}
              placeholder="网关侧统一附加的 system 指令…"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">请求日志</p>
            <p className="text-xs text-muted-foreground">记录每次网关调用的路由、转移与检测结果。</p>
          </div>
          <Switch
            checked={policies.loggingEnabled}
            onCheckedChange={(v) => patch((p) => ({ ...p, loggingEnabled: !!v }))}
            aria-label="启用请求日志"
          />
        </CardContent>
      </Card>
    </div>
  );
}
