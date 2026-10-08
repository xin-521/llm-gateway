import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Copy, RefreshCw, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { GatewayKey } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

function copyText(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("已复制到剪贴板"))
    .catch(() => toast.error("复制失败"));
}

export default function KeysPage() {
  const qc = useQueryClient();
  const { data: keys } = useQuery({
    queryKey: ["keys"],
    queryFn: () => api.get<GatewayKey[]>("/keys"),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("60");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["keys"] });

  const create = useMutation({
    mutationFn: () =>
      api.post<GatewayKey>("/keys", {
        name: name || "未命名密钥",
        rateLimitPerMin: Number(rate) || 0,
        allowedModels: "all",
      }),
    onSuccess: (k) => {
      setNewKey(k.key);
      setCreateOpen(false);
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.post<GatewayKey>(`/keys/${id}/rotate`),
    onSuccess: (k) => {
      setNewKey(k.key);
      setRotateId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/keys/${id}`, { enabled }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/keys/${id}`),
    onSuccess: () => {
      setDeleteId(null);
      invalidate();
    },
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API 密钥管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            客户端调用网关时使用这些 <span className="font-mono text-foreground">sk-gw-…</span> 密钥鉴权，
            支持限流与启用/禁用。完整密钥仅在创建或轮换时展示一次。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1.5" /> 新建密钥
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>密钥</TableHead>
                  <TableHead>限流/分钟</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近使用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(keys ?? []).map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.key}</TableCell>
                    <TableCell className="font-mono">
                      {k.rateLimitPerMin > 0 ? k.rateLimitPerMin : (
                        <Badge variant="secondary" className="text-[10px]">不限</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={k.enabled}
                        onCheckedChange={(v) => toggle.mutate({ id: k.id, enabled: !!v })}
                        aria-label={`启用密钥 ${k.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "从未"}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRotateId(k.id)}
                        aria-label="轮换密钥"
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(k.id)}
                        aria-label="删除密钥"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!keys?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      暂无密钥，点击右上角新建。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> 新建 API 密钥
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：生产环境后端" />
            </div>
            <div className="space-y-1.5">
              <Label>每分钟请求上限（0 = 不限）</Label>
              <Input
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* one-time key reveal */}
      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>密钥已生成 — 仅显示这一次</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning mb-3">
            请立即复制并妥善保存。离开本对话框后列表中将只显示掩码。
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-secondary px-3 py-2.5 font-mono text-xs break-all">
              {newKey}
            </code>
            <Button size="icon" variant="outline" onClick={() => newKey && copyText(newKey)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* rotate confirm */}
      <AlertDialog open={!!rotateId} onOpenChange={(o) => !o && setRotateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>轮换密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              旧密钥将立即失效，新密钥仅展示一次。使用旧密钥的客户端会收到 401。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => rotateId && rotate.mutate(rotateId)}
            >
              轮换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除密钥？</AlertDialogTitle>
            <AlertDialogDescription>使用该密钥的应用将立即无法访问网关。</AlertDialogDescription>
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
