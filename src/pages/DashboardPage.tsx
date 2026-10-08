import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  ArrowRightLeft,
  ShieldBan,
  Gauge,
  Server,
  KeyRound,
  Zap,
  Hash,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { Stats } from "@/lib/types";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { HealthBadge } from "@/components/gateway-badges";
import { Skeleton } from "@/components/ui/skeleton";

const chartConfig = {
  requests: { label: "请求", color: "var(--color-chart-1)" },
  failures: { label: "失败", color: "var(--color-chart-4)" },
} satisfies ChartConfig;

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-3xl font-semibold tracking-tight font-mono">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.get<Stats>("/stats"),
    refetchInterval: 8000,
  });
  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.get<import("@/lib/types").Provider[]>("/providers"),
    refetchInterval: 8000,
  });

  if (!stats) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  const hourlyData = stats.hourly.map((h) => ({
    name: `-${h.hour}h`,
    requests: h.requests,
    failures: h.failures,
  }));

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">总览</h1>
        <p className="text-sm text-muted-foreground mt-1">
          近 24 小时网关运行状况，每 8 秒自动刷新。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Activity}
          label="请求总量"
          value={stats.total24h}
          sub={`成功率 ${stats.total24h ? Math.round((stats.success24h / stats.total24h) * 100) : 100}%`}
        />
        <Kpi
          icon={ArrowRightLeft}
          label="故障转移次数"
          value={stats.failovers}
          sub="备用供应商自动接管"
        />
        <Kpi
          icon={ShieldBan}
          label="注入检测命中"
          value={stats.injectionHits}
          sub={`其中拦截 ${stats.blocked} 次`}
        />
        <Kpi icon={Gauge} label="平均延迟" value={`${stats.avgLatency}ms`} sub={`Token 用量 ${stats.tokens}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="size-4 text-primary" />
              请求流量（近 24 小时）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <BarChart data={hourlyData}>
                <CartesianGrid vertical={false} stroke="hsl(222 18% 17%)" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} interval={3} />
                <YAxis tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip
                  contentStyle={{
                    background: "hsl(223 24% 11%)",
                    border: "1px solid hsl(222 18% 19%)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="requests" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="failures" fill="var(--color-chart-4)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Server className="size-4 text-primary" />
                供应商健康
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                <KeyRound className="inline size-3 mr-1" />
                {stats.activeKeys} 个活跃密钥
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(providers ?? []).map((p) => {
              const h = stats.health[p.id];
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate flex items-center gap-1.5">
                      {p.mock && <Zap className="size-3 text-muted-foreground shrink-0" />}
                      {p.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {p.protocol} · 优先级 {p.priority} · {p.enabled ? "启用" : "停用"}
                    </p>
                  </div>
                  <HealthBadge state={h?.state ?? "healthy"} />
                </div>
              );
            })}
            {!providers?.length && (
              <p className="text-sm text-muted-foreground">尚未配置供应商。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
