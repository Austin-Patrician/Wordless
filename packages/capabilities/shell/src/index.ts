import type { CommandSecurityRule, CustomCommandSecurityRule, ToolSecurityRuleMatch } from "@wordless/domain";

export const BUILTIN_COMMAND_SECURITY_RULES: readonly CommandSecurityRule[] = [
  { id: "builtin.recursive-delete-rm", label: "Recursive deletion", command: "rm -r", source: "builtin" },
  { id: "builtin.recursive-delete-rm-force", label: "Recursive deletion", command: "rm -rf", source: "builtin" },
  { id: "builtin.recursive-delete-rm-force-reordered", label: "Recursive deletion", command: "rm -fr", source: "builtin" },
  { id: "builtin.recursive-delete-rmdir", label: "Recursive deletion", command: "rmdir", source: "builtin" },
  { id: "builtin.recursive-delete-del", label: "Recursive deletion", command: "del /s", source: "builtin" },
  { id: "builtin.recursive-delete-powershell", label: "Recursive deletion", command: "remove-item -recurse", source: "builtin" },
  { id: "builtin.git-reset", label: "Destructive Git rewrite", command: "git reset --hard", source: "builtin" },
  { id: "builtin.git-clean", label: "Destructive Git rewrite", command: "git clean -f", source: "builtin" },
  { id: "builtin.git-force-push", label: "Force push", command: "git push --force", source: "builtin" },
  { id: "builtin.privilege-sudo", label: "Privilege escalation", command: "sudo", source: "builtin" },
  { id: "builtin.privilege-su", label: "Privilege escalation", command: "su ", source: "builtin" },
  { id: "builtin.permission-chmod", label: "Permission changes", command: "chmod", source: "builtin" },
  { id: "builtin.permission-chown", label: "Permission changes", command: "chown", source: "builtin" },
  { id: "builtin.permission-icacls", label: "Permission changes", command: "icacls", source: "builtin" },
  { id: "builtin.permission-takeown", label: "Permission changes", command: "takeown", source: "builtin" },
  { id: "builtin.system-taskkill", label: "Process termination", command: "taskkill", source: "builtin" },
  { id: "builtin.system-kill", label: "Process termination", command: "kill -9", source: "builtin" },
  { id: "builtin.system-shutdown", label: "System shutdown", command: "shutdown", source: "builtin" },
  { id: "builtin.system-reboot", label: "System shutdown", command: "reboot", source: "builtin" },
  { id: "builtin.system-format", label: "Disk operation", command: "format", source: "builtin" },
  { id: "builtin.system-diskpart", label: "Disk operation", command: "diskpart", source: "builtin" },
  { id: "builtin.system-dd", label: "Disk operation", command: "dd ", source: "builtin" },
  { id: "builtin.download-execute-curl", label: "Download and execute", command: "curl |", source: "builtin" },
  { id: "builtin.download-execute-wget", label: "Download and execute", command: "wget |", source: "builtin" },
  { id: "builtin.download-execute-iex", label: "Download and execute", command: "invoke-expression", source: "builtin" },
  { id: "builtin.install-npm", label: "Dependency installation", command: "npm install", source: "builtin" },
  { id: "builtin.install-pnpm", label: "Dependency installation", command: "pnpm install", source: "builtin" },
  { id: "builtin.install-yarn", label: "Dependency installation", command: "yarn install", source: "builtin" },
  { id: "builtin.install-bun", label: "Dependency installation", command: "bun install", source: "builtin" },
  { id: "builtin.install-pip", label: "Dependency installation", command: "pip install", source: "builtin" },
  { id: "builtin.install-cargo", label: "Dependency installation", command: "cargo add", source: "builtin" },
  { id: "builtin.install-go", label: "Dependency installation", command: "go get", source: "builtin" },
  { id: "builtin.publish-npm", label: "Package publication", command: "npm publish", source: "builtin" },
  { id: "builtin.publish-pnpm", label: "Package publication", command: "pnpm publish", source: "builtin" },
  { id: "builtin.publish-yarn", label: "Package publication", command: "yarn publish", source: "builtin" },
  { id: "builtin.publish-pip", label: "Package publication", command: "pip upload", source: "builtin" },
  { id: "builtin.publish-docker", label: "Container publication", command: "docker push", source: "builtin" },
  { id: "builtin.git-push", label: "Remote Git push", command: "git push", source: "builtin" },
  { id: "builtin.github-merge", label: "Pull request merge", command: "gh pr merge", source: "builtin" },
];

function normalizeCommand(value: string): string {
  return ` ${value.trim().replace(/\s+/g, " ").toLowerCase()} `;
}

export function resolveCommandSecurityRules(customRules: readonly CustomCommandSecurityRule[]): CommandSecurityRule[] {
  return [
    ...BUILTIN_COMMAND_SECURITY_RULES,
    ...customRules.map((rule) => ({ ...rule, source: "custom" as const })),
  ];
}

export function matchCommandSecurityRules(command: string, rules: readonly CommandSecurityRule[]): ToolSecurityRuleMatch[] {
  const normalized = normalizeCommand(command);
  return rules.flatMap((rule) => normalized.includes(normalizeCommand(rule.command))
    ? [{ category: "command" as const, id: rule.id, label: rule.label, source: rule.source }]
    : []);
}
