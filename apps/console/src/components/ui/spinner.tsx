// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../../i18n/ui-text";
import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon role="status" aria-label={uiText("Loading")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
