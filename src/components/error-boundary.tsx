import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Optional fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level React error boundary. Keeps a single failing route from blanking
 * the whole console; shows a recoverable fallback instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the host (Vesa preview) and the browser console.
    console.error("[llm-gateway] render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="min-h-[60vh] grid place-items-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto size-12 rounded-full bg-destructive/10 grid place-items-center">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight">页面渲染出错</h2>
            <p className="text-sm text-muted-foreground break-words">
              {error.message || "发生了未知错误。"}
            </p>
          </div>
          <Button onClick={this.reset} variant="outline">
            <RotateCcw className="size-4 mr-2" /> 重试
          </Button>
        </div>
      </div>
    );
  }
}
