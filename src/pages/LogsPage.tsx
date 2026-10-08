import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ChevronDown, ChevronRight, ArrowRightLeft, ShieldBan, Search, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { api } from "@/lib/api";
import type { LogEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProtocolBadge } from "@/components/gateway-badges";
import { cn } from "@/lib/utils";

function statusClass(code: number): string {
  if (code >= 500) return "text-destructive";
  if (code >= 400) return "text-warning";
  return "text-success";
}

export default function LogsPage() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "client" | "server" | "blocked">(
    "all"
  );
  const { data: logs } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.get<LogEntry[]>("/logs"),
    refetchInterval: 5000,
  });

  const clear = useMutation({
    mutationFn: () => api.del("/logs"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs"] }),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logs ?? []).filter((log) => {
      if (statusFilter === "blocked" && !log.blocked) return false;
      if (statusFilter === "success" && log.status >= 400) return false;
      if (statusFilter === "client" && !(log.status >= 400 && log.status < 500)) return false;
      if (statusFilter === "server" && log.status < 500) return false;
      if (!q) return true;
      return (
        log.model.toLowerCase().includes(q) ||
        log.keyName.toLowerCase().includes(q) ||
        (log.servedByName ?? "").toLowerCase().includes(q) ||
        String(log.status).includes(q) ||
        log.injectionHits.some((h) => h.toLowerCase().includes(q))
      );
    });
  }, [logs, query, statusFilter]);

  const FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "success", label: "成功" },
    { key: "client", label: "4xx" },
    { key: "server", label: "5xx" },
    { key: "blocked", label: "已拦截" },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">请求日志</h1>
          <p className="text-sm text-muted-foreground mt-1">
            最近 {logs?.length ?? 0} 条网关调用（自动刷新，保留最新 300 条）。点击行查看路由尝试明细。
          </p>
        </div>
        <Button variant="outline" onClick={() => clear.mutate()} disabled={clear.isPending}>
          <Trash2 className="size-4 mr-1.5" /> 清空日志
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型 / 密钥 / 供应商 / 状态码"
            className="pl-8 pr-8"
            aria-label="搜索日志"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="清除搜索"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              aria-pressed={statusFilter === f.key}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            >
              <Badge variant={statusFilter === f.key ? "default" : "outline"} className="cursor-pointer select-none">
                {f.label}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>时间</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>协议</TableHead>
                  <TableHead>密钥</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>服务供应商</TableHead>
                  <TableHead>转移</TableHead>
                  <TableHead>延迟</TableHead>
                  <TableHead>Token</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    open={expanded === log.id}
                    onToggle={() => setExpanded(expanded === log.id ? null : log.id)}
                  />
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      {logs?.length ? "没有匹配当前筛选条件的日志。" : "暂无请求记录。可在 Playground 发起一次测试调用。"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LogRow({
  log,
  open,
  onToggle,
}: {
  log: LogEntry;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        onClick={onToggle}
        className="cursor-pointer"
        aria-expanded={open}
      >
        <TableCell className="text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap">
          {formatDistanceToNow(log.ts, { addSuffix: true, locale: zhCN })}
        </TableCell>
        <TableCell className="font-mono text-xs">{log.model}</TableCell>
        <TableCell>
          <ProtocolBadge protocol={log.clientProtocol} />
        </TableCell>
        <TableCell className="text-sm">{log.keyName}</TableCell>
        <TableCell>
          <span className={cn("font-mono text-sm font-medium", statusClass(log.status))}>
            {log.status}
          </span>
          {log.blocked && (
            <Badge variant="destructive" className="ml-2 text-[10px]">
              <ShieldBan className="size-3 mr-1" /> 已拦截
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-sm max-w-40 truncate">
          {log.servedByName ?? <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell>
          {log.failoverCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning text-sm font-mono">
              <ArrowRightLeft className="size-3.5" /> {log.failoverCount}
            </span>
          ) : (
            <span className="text-muted-foreground font-mono">0</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm">{log.latencyMs}ms</TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {log.promptTokens}/{log.completionTokens}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-secondary/30 hover:bg-secondary/30">
          <TableCell colSpan={10} className="py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  路由尝试链
                </p>
                <ol className="space-y-1.5">
                  {log.attempts.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm font-mono">
                      <span className="text-muted-foreground">#{i + 1}</span>
                      <span>{a.providerName}</span>
                      <span
                        className={cn(
                          a.status === 200 || (typeof a.status === "number" && a.status < 400)
                            ? "text-success"
                            : "text-destructive"
                        )}
                      >
                        → {a.status}
                      </span>
                      <span className="text-muted-foreground">{a.ms}ms</span>
                      {a.error && (
                        <span className="text-muted-foreground truncate max-w-64">({a.error})</span>
                      )}
                    </li>
                  ))}
                  {!log.attempts.length && (
                    <li className="text-sm text-muted-foreground">请求在网关侧被拦截，未到达上游。</li>
                  )}
                </ol>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">详情</p>
                <div className="space-y-1 text-sm font-mono">
                  <p>endpoint: {log.endpoint}</p>
                  <p>stream: {log.stream ? "yes" : "no"}</p>
                  <p>
                    injection hits:{" "}
                    {log.injectionHits.length ? (
                      <span className="text-warning">{log.injectionHits.join(", ")}</span>
                    ) : (
                      "none"
                    )}
                  </p>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
