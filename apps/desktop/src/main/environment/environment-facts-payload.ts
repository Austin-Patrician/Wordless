import type { HostEnvironmentFacts, HostOcrStatus } from "@wordless/protocol";

/**
 * 环境面板要的那份载荷:宿主事实 + 文字识别状态。
 *
 * 抽成纯函数有两个理由,第二个是**真出过事**:
 * 1. 两个服务各自独立(`HostEnvironmentService` 只探测 shell/node/python),合成发生在边界上;
 * 2. `facts()` 是异步的。曾经这里写成 `{ ...options.hostEnvironment.facts() }` —— 展开的是个
 *    Promise,载荷变成 `{}`,界面读 `facts.node.found` 直接炸。所以这里的参数**就是"读事实的
 *    异步函数"**:想拿到内容就必须 await,漏写在结构上不可能。
 */
export interface EnvironmentFactsSources {
  readFacts: () => Promise<HostEnvironmentFacts>;
  /** 没有文字识别服务时(例如构建里没有)传 undefined。 */
  readOcrStatus?: () => Promise<HostOcrStatus>;
}

export async function environmentFactsPayload(sources: EnvironmentFactsSources): Promise<HostEnvironmentFacts> {
  const facts = await sources.readFacts();
  const readOcrStatus = sources.readOcrStatus;
  return {
    ...facts,
    ocr: readOcrStatus
      ? await readOcrStatus()
      : { available: false, modelSet: null, detail: "Text recognition is not part of this build." },
  };
}
