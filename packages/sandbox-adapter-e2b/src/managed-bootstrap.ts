// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
// Compatibility exports; the native management protocol is SDK-independent.
export {
  startE2BManagedProcess, inspectE2BManagedSlot, restoreE2BManagedProcess,
  type E2BManagedBootstrapOptions, type E2BManagementObservation,
  type E2BManagedIdentity, type E2BManagedLocator,
} from "@open-managed-agents/sandbox-port-kit/managed-bootstrap";
