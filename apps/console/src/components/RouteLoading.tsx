// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../i18n/ui-text";
import { Button } from "./ui/button";
import { OpenmaStartupLoader } from "./OpenmaStartupLoader";

export function RouteLoading() {
  return <div className="flex h-screen items-center justify-center bg-bg" role="status" aria-label={uiText("Loading page")}>
    <OpenmaStartupLoader />
  </div>;
}

/** A failed chunk must leave a visible way back, including on direct visits. */
export function RouteLoadError() {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg">
    <h1 className="text-lg font-medium">{uiText("Couldn’t load this page")}</h1>
    <p className="text-sm text-fg-muted">{uiText("Check your connection and reload to try again.")}</p>
    <Button onClick={() => window.location.reload()}>{uiText("Reload page")}</Button>
    <a href="/login" className="text-sm underline">{uiText("Back to sign in")}</a>
  </main>;
}
