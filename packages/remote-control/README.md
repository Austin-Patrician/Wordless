# @wordless/remote-control

远程访问的**协议与连接生命周期**。它只定义"两端怎么说话",不定义 UI、不定义 WebSocket/中继实现、
不定义会话执行语义 —— 所以本机服务、中继、浏览器客户端三方可以各自实现它。

设计文档:`docs/architecture/remote-access.md`(§5 设计、§6 安全)。

## 它拥有什么

- **版本化的帧**与边界校验(`src/types.ts`、`src/protocol.ts`)
- **端到端加密**:X25519 身份密钥 + 每次连接的临时密钥 → 三重 DH → HKDF → 方向密钥 → XChaCha20-Poly1305(`src/crypto.ts`)
- **请求/响应关联、事件序号与 ACK、断线恢复**(`src/connection.ts`)
- **出站事件日志**:换链路或重连后只补缺失的尾部,补不了就明确要求整体重拉(`src/event-journal.ts`)
- **配对材料**:连接码 + 密码 + 中继信箱信封 + 二维码文本(`src/invite-code.ts`)
- **可注入延迟/丢帧/断线的假传输与假中继**(`src/fake-transport.ts`、`src/fake-relay.ts`)

## 它不拥有什么

- 中继的部署形态(本包只提供**内存版假中继**用于测试;真实中继另实现同一份合同)
- WebSocket、文件系统、系统凭据库
- 会话执行语义(那些留在 `@wordless/runtime` 与本机服务里)

## 运行

```bash
npm test -w @wordless/remote-control      # node --test
npm run check -w @wordless/remote-control # tsc --noEmit
```

测试**不需要真手机、不需要任何云账号** —— 这正是假传输与假中继存在的理由。
