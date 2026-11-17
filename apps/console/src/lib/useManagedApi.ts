// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { useMemo } from "react";
import { useApi } from "./api";
import { createManagedApiClient } from "./managed-api";

/** Cookie- and tenant-aware browser client whose public surface mirrors the
 * Managed Agents SDK resource hierarchy. Product-only `/v1/maishu/*` endpoints
 * intentionally remain on `useApi()` so the protocol boundary is visible at
 * every call site. */
export function useManagedApi() {
  const { api, apiRaw, apiStream } = useApi();
  return useMemo(
    () =>
      createManagedApiClient({
        request: api,
        raw: apiRaw,
        stream: apiStream,
      }),
    [api, apiRaw, apiStream],
  );
}
