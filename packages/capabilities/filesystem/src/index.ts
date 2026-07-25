import { matchesGlob } from "node:path";
import type { CustomFileSecurityRule, FileSecurityRule, ToolSecurityRuleMatch } from "@wordless/domain";

export const BUILTIN_FILE_SECURITY_RULES: readonly FileSecurityRule[] = [
  { id: "builtin.env", label: "Environment files", pattern: ".env", source: "builtin" },
  { id: "builtin.env-nested", label: "Environment files", pattern: "**/.env", source: "builtin" },
  { id: "builtin.env-variant", label: "Environment files", pattern: ".env.*", source: "builtin" },
  { id: "builtin.env-variant-nested", label: "Environment files", pattern: "**/.env.*", source: "builtin" },
  { id: "builtin.git", label: "Git metadata", pattern: ".git/**", source: "builtin" },
  { id: "builtin.git-nested", label: "Git metadata", pattern: "**/.git/**", source: "builtin" },
  { id: "builtin.node-modules", label: "Installed dependencies", pattern: "node_modules/**", source: "builtin" },
  { id: "builtin.node-modules-nested", label: "Installed dependencies", pattern: "**/node_modules/**", source: "builtin" },
  { id: "builtin.credentials", label: "Credential configuration", pattern: "{.npmrc,.pypirc,.netrc,.git-credentials}", source: "builtin" },
  { id: "builtin.credentials-nested", label: "Credential configuration", pattern: "**/{.npmrc,.pypirc,.netrc,.git-credentials}", source: "builtin" },
  { id: "builtin.aws", label: "Cloud credentials", pattern: ".aws/**", source: "builtin" },
  { id: "builtin.aws-nested", label: "Cloud credentials", pattern: "**/.aws/**", source: "builtin" },
  { id: "builtin.private-key", label: "Private key files", pattern: "**/*.{pem,key}", source: "builtin" },
  { id: "builtin.ssh-key", label: "SSH private keys", pattern: "{id_rsa,id_ed25519}", source: "builtin" },
  { id: "builtin.ssh-key-nested", label: "SSH private keys", pattern: "**/{id_rsa,id_ed25519}", source: "builtin" },
];

function portablePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isValidFileSecurityPattern(pattern: string): boolean {
  try {
    matchesGlob("wordless", pattern);
    return true;
  } catch {
    return false;
  }
}

export function resolveFileSecurityRules(customRules: readonly CustomFileSecurityRule[]): FileSecurityRule[] {
  return [
    ...BUILTIN_FILE_SECURITY_RULES,
    ...customRules.map((rule) => ({ ...rule, source: "custom" as const })),
  ];
}

export function matchFileSecurityRules(pathname: string, rules: readonly FileSecurityRule[]): ToolSecurityRuleMatch[] {
  const path = portablePath(pathname);
  return rules.flatMap((rule) => matchesGlob(path, rule.pattern)
    ? [{ category: "file" as const, id: rule.id, label: rule.label, source: rule.source }]
    : []);
}
