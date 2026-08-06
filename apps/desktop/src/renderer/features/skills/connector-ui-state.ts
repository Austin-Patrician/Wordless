export type ConnectorOperation = "authorize" | "enabled" | "remove" | "test" | "trust";

export type ConnectorErrorKind =
  | "authorization-busy"
  | "authorization-denied"
  | "authorization-expired"
  | "authorization-failed"
  | "authorization-timeout"
  | "operation-failed"
  | "test-failed";

export function connectorErrorDetail(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").trim();
}

export function connectorErrorKind(detail: string, operation: ConnectorOperation): ConnectorErrorKind {
  if (/access_denied|authorization denied|user denied|cancelled by (?:the )?user/i.test(detail)) return "authorization-denied";
  if (/timed? out|timeout/i.test(detail)) return "authorization-timeout";
  if (/EADDRINUSE|address already in use|listen.*18191/i.test(detail)) return "authorization-busy";
  if (/state did not match|state mismatch/i.test(detail)) return "authorization-expired";
  if (operation === "authorize") return "authorization-failed";
  if (operation === "test" || operation === "trust") return "test-failed";
  return "operation-failed";
}

export function hasActiveConnectorAuthorization(operations: Readonly<Record<string, ConnectorOperation>>): boolean {
  return Object.values(operations).includes("authorize");
}
