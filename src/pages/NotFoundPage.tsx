import { Link } from "react-router-dom";
import { Compass, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="min-h-[70vh] grid place-items-center p-6">
      <div className="max-w-md text-center space-y-5 animate-fade-up">
        <div className="mx-auto size-14 rounded-2xl bg-secondary grid place-items-center">
          <Compass className="size-7 text-primary" />
        </div>
        <div className="space-y-2">
          <p className="font-mono text-sm text-muted-foreground">404 · NOT FOUND</p>
          <h1 className="text-2xl font-semibold tracking-tight">页面不存在</h1>
          <p className="text-sm text-muted-foreground">
            你访问的路径没有对应的控制台页面，可能已被移动或输入有误。
          </p>
        </div>
        <Button asChild>
          <Link to="/">
            <ArrowLeft className="size-4 mr-2" /> 返回总览
          </Link>
        </Button>
      </div>
    </div>
  );
}
