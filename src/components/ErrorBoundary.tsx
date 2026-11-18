import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  t?: (zh: string, en: string) => string;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // `??` 在这里是个坑：`null ?? 默认` 会求值成默认——调用方显式传
      // fallback={null}（「失败就渲染空」）必须与「没传」区分开。
      if (this.props.fallback !== undefined) return this.props.fallback;
      const { t } = this.props;
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "var(--red)", marginBottom: 12 }}>
            {t ? t("页面渲染出错，请刷新重试。", "Something went wrong.") : "Something went wrong."}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            {t ? t("重新加载", "Reload") : "Reload"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
