import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Zap, GripVertical, Sparkles, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HealthBadge, ProtocolBadge } from "@/components/gateway-badges";
import { toast } from "sonner";

interface FormState {
  id?: string;
  name: string;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  models: string;
  priority: number;
  enabled: boolean;
  mock: boolean;
  failRate: number;
  latencyMs: number;
}

const EMPTY: FormState = {
  name: "",
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  models: "gpt-4o, gpt-4o-mini",
  priority: 1,
  enabled: true,
  mock: false,
  failRate: 0,
  latencyMs: 300,
};

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.get<Provider[]>("/providers"),
  });
  const { data: health } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.get<import("@/lib/types").Stats>("/stats"),
    refetchInterval: 8000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detected, setDetected] = useState<string[] | null>(null);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const lastDetectSig = useRef("");

  const detect = useMutation({
    mutationFn: () =>
      api.post<{ models: string[]; note?: string }>("/providers/discover-models", {
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        protocol: form.protocol,
        providerId: form.id,
      }),
    onSuccess: (r) => {
      if (r.models.length) {
        setDetected(r.models);
        setDetectNote(null);
        setForm((f) => ({ ...f, models: r.models.join(", ") }));
        toast.success(`已自动识别 ${r.models.length} 个模型`);
      } else {
        setDetected(null);
        setDetectNote(r.note ?? "上游未返回模型列表");
        toast.warning("未自动识别到模型，已回退为手动填写");
      }
    },
    onError: (e: Error) => {
      setDetected(null);
      setDetectNote(e.message);
      toast.warning("自动识别失败，已回退为手动填写");
    },
  });

  const selectedModels = form.models
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const toggleModel = (m: string) => {
    const set = new Set(selectedModels);
    if (set.has(m)) set.delete(m);
    else set.add(m);
    setForm({ ...form, models: Array.from(set).join(", ") });
  };

  /** Auto-probe the provider once per distinct baseUrl/key/protocol. */
  const maybeDetect = (force = false) => {
    if (form.mock || !form.baseUrl) return;
    if (!form.apiKey && !form.id) return;
    const sig = `${form.id ?? ""}|${form.protocol}|${form.baseUrl}|${form.apiKey ? "k" : ""}`;
    if (!force && (sig === lastDetectSig.current || detect.isPending)) return;
    lastDetectSig.current = sig;
    detect.mutate();
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["providers"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        name: f.name,
        protocol: f.protocol,
        baseUrl: f.baseUrl,
        apiKey: f.apiKey,
        models: f.models.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
        priority: f.priority,
        enabled: f.enabled,
        mock: f.mock,
        failRate: f.failRate,
        latencyMs: f.latencyMs,
      };
      return f.id ? api.put<Provider>(`/providers/${f.id}`, body) : api.post<Provider>("/providers", body);
    },
    onSuccess: () => {
      toast.success("供应商已保存");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/providers/${id}`),
    onSuccess: () => {
      toast.success("已删除");
      setDeleteId(null);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (p: Provider) => api.put(`/providers/${p.id}`, { enabled: !p.enabled }),
    onSuccess: invalidate,
  });

  const openEdit = (p?: Provider) => {
    setDetected(null);
    setDetectNote(null);
    lastDetectSig.current = "";
    if (p) {
      setForm({
        id: p.id,
        name: p.name,
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey.includes("•") ? "" : p.apiKey,
        models: p.models.join(", "),
        priority: p.priority,
        enabled: p.enabled,
        mock: !!p.mock,
        failRate: p.failRate ?? 0,
        latencyMs: p.latencyMs ?? 300,
      });
    } else {
      setForm({ ...EMPTY, priority: (providers?.length ?? 0) + 1 });
    }
    setDialogOpen(true);
  };

  const sorted = [...(providers ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">模型供应商</h1>
          <p className="text-sm text-muted-foreground mt-1">
            按优先级构成故障转移链：请求失败或熔断时自动切换到下一供应商。
          </p>
        </div>
        <Button onClick={() => openEdit()}>
          <Plus className="size-4 mr-1.5" /> 添加供应商
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">顺序</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>协议</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead>健康状态</TableHead>
                  <TableHead>启用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 font-mono text-sm text-muted-foreground">
                        <GripVertical className="size-3.5 opacity-40" />
                        {p.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-medium">
                        {p.mock && (
                          <Zap className="size-3.5 text-primary" aria-label="内置 Mock 上游" />
                        )}
                        {p.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ProtocolBadge protocol={p.protocol} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-56">
                        {p.models.slice(0, 3).map((m) => (
                          <Badge key={m} variant="outline" className="font-mono text-[10px]">
                            {m}
                          </Badge>
                        ))}
                        {p.models.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{p.models.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-48 truncate">
                      {p.mock ? "内置模拟上游" : p.baseUrl}
                    </TableCell>
                    <TableCell>
                      <HealthBadge state={health?.health[p.id]?.state ?? "healthy"} />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={() => toggle.mutate(p)}
                        aria-label={`启用 ${p.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} aria-label="编辑">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(p.id)}
                          aria-label="删除"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!sorted.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      尚无供应商，点击右上角添加。带 <Zap className="inline size-3 text-primary" /> 的为内置 Mock 演示节点。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* editor dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "编辑供应商" : "添加供应商"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Production OpenAI"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>协议</Label>
                <Select
                  value={form.protocol}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      protocol: v as "openai" | "anthropic",
                      baseUrl:
                        v === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI 兼容</SelectItem>
                    <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-priority">故障转移优先级（越小越优先）</Label>
                <Input
                  id="p-priority"
                  type="number"
                  min={1}
                  max={20}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-baseurl">Base URL</Label>
              <Input
                id="p-baseurl"
                value={form.baseUrl}
                disabled={form.mock}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                onBlur={() => maybeDetect()}
                className="font-mono text-sm"
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-key">API Key {form.id && "（留空保持不变）"}</Label>
              <Input
                id="p-key"
                type="password"
                value={form.apiKey}
                disabled={form.mock}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                onBlur={() => maybeDetect()}
                className="font-mono text-sm"
                placeholder="sk-…"
              />
              <p className="text-[11px] text-muted-foreground">
                密钥仅存于边缘 KV 配置中，网关转发时注入上游请求，不会下发给前端。
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="p-models">支持的模型（逗号分隔）</Label>
                <button
                  type="button"
                  onClick={() => maybeDetect(true)}
                  disabled={detect.isPending || form.mock || !form.baseUrl}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                >
                  {detect.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {detect.isPending ? "识别中…" : "自动识别"}
                </button>
              </div>
              <Input
                id="p-models"
                value={form.models}
                onChange={(e) => setForm({ ...form, models: e.target.value })}
                className="font-mono text-sm"
                placeholder="gpt-4o, claude-sonnet-4-5"
              />
              {detected && detected.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1 max-h-32 overflow-y-auto">
                  {detected.map((m) => {
                    const on = selectedModels.includes(m);
                    return (
                      <button
                        type="button"
                        key={m}
                        onClick={() => toggleModel(m)}
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          on
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
              {detectNote && !detected && (
                <p className="text-[11px] text-warning">
                  无法自动识别（{detectNote}），请手动填写。
                </p>
              )}
            </div>
            <label className="flex items-center gap-2.5 text-sm cursor-pointer pt-1">
              <Switch checked={form.mock} onCheckedChange={(v) => setForm({ ...form, mock: !!v })} />
              内置 Mock 上游（演示用，无需真实密钥即可体验故障转移）
            </label>
            {form.mock && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-fail">模拟失败率 {Math.round(form.failRate * 100)}%</Label>
                  <input
                    id="p-fail"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.failRate}
                    onChange={(e) => setForm({ ...form, failRate: Number(e.target.value) })}
                    className="w-full accent-[hsl(32_92%_54%)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-lat">模拟延迟 (ms)</Label>
                  <Input
                    id="p-lat"
                    type="number"
                    min={0}
                    value={form.latencyMs}
                    onChange={(e) => setForm({ ...form, latencyMs: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该供应商？</AlertDialogTitle>
            <AlertDialogDescription>
              将从故障转移链中移除。使用其模型的外部请求可能失败。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && remove.mutate(deleteId)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
