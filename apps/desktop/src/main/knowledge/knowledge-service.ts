import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, posix, relative, sep } from "node:path";
import {
  KNOWLEDGE_CONCEPTS_DIR,
  KNOWLEDGE_ENTITIES_DIR,
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_LOG_FILE,
  KNOWLEDGE_RAWS_DIR,
  KNOWLEDGE_SOURCES_DIR,
  KNOWLEDGE_TYPE_DIRECTORIES,
  directoryOf,
  isWritablePagePath,
  toBundleResource,
} from "./knowledge-layout.ts";
import {
  appendKnowledgeLog,
  buildKnowledgeIndex,
  type KnowledgeLogKind,
  type KnowledgePageEntry,
} from "./knowledge-derived.ts";
import { buildHealthReport, type KnowledgeHealthReport } from "./knowledge-lint.ts";
import { freeImportPath, planImport, readImportedBundle, type ImportedBundle, type ImportPlan } from "./knowledge-import.ts";
import {
  applyVerificationGate,
  diffKnowledge,
  diffNeedsProcessing,
  isDiffEmpty,
  planOrphanReaping,
  rawsResource,
  withoutSourceReference,
  type KnowledgeDiff,
  type RawSnapshot,
  type SourcePageSnapshot,
} from "./knowledge-diff.ts";
import {
  applyQuarantine,
  EMPTY_KNOWLEDGE_FAILURES,
  normalizeKnowledgeFailures,
  pruneFailures,
  quarantinedPaths,
  reconcileFailures,
  type KnowledgeFailures,
} from "./knowledge-failures.ts";
import {
  isHumanVerified,
  parseKnowledgePage,
  serializeKnowledgePage,
  type KnowledgePage,
  type KnowledgePageStatus,
  type KnowledgePageType,
} from "./knowledge-schema.ts";

/**
 * 知识库的**文件系统实现**。
 *
 * 这一层只做 IO:读字节、写文件、遍历目录。**判定与生成都在纯模块里**(`knowledge-schema` /
 * `knowledge-layout` / `knowledge-derived`),所以那些规则可以离线测,而这里只负责把它们
 * 落到磁盘上。
 *
 * 每一次写入都是"读旧 → 改 → 写回"的整文件替换:页面是小的 markdown,不需要增量写,
 * 而整文件替换不会有半截文件的问题。
 */

/** 扫描结果:解析成功的页 + 解析失败的文件(失败要上报,不能让一个坏页毁掉整次扫描)。 */
export interface KnowledgeScan {
  entries: KnowledgePageEntry[];
  damaged: Array<{ path: string; issue: string }>;
}

export interface KnowledgeWriteRequest {
  /** 相对 bundle 根的页面路径,如 `concepts/增值税流程.md`。 */
  path: string;
  type: KnowledgePageType;
  title: string;
  description: string;
  tags: string[];
  sources?: Array<{ id?: string; resource: string }>;
  body: string;
  /** 写入者标识(actor 约定)。 */
  by: string;
  /** 时间戳(ISO)。由调用方给,便于测试与"同一轮用同一个时间"。 */
  now: string;
  /** 原始文件内容 hash(源页用)。 */
  sourceHash?: string;
}

/** 一轮加工的规划:交给 agent 的待办 + 工程侧已经做完的事。 */
/** 一轮跑完后**实际**发生了什么(与失败账本同源)。 */
export interface KnowledgeRoundResult {
  /** 页写出来了,且内容与原文一致。 */
  written: string[];
  /** 试过但没写成,而且原文还在(已记进失败账本)。 */
  failed: string[];
  /** 试过但原文已被删除 —— 会走孤儿回收,不算失败。 */
  gone: string[];
}

export interface KnowledgeRoundPlan {
  diff: KnowledgeDiff;
  /** 被隔离、这一轮没交给 agent 的文件。要报出来,不能静默跳过。 */
  skipped: RawSnapshot[];
  /** 这一轮回收掉的孤儿页。 */
  reaped: Array<{ pagePath: string; resource: string }>;
  /** 因为每轮上限而**留给下一轮**的文件数(不需要游标:下一轮它们仍然是"新增")。 */
  deferred: number;
  /**
   * 需要**人工复核**的页:人工复核过、但来源变了(复核已过期),或回收时因为复核而留下的。
   * 它们不进 agent 的待办 —— 交给人。
   */
  needsReview: Array<{ pagePath: string; resource: string }>;
  /** 什么都没发生(没有变更、也没有要回收的孤儿)。 */
  empty: boolean;
  /** 有没有需要 agent 读原文的活(只有 added / changed 需要)。 */
  needsProcessing: boolean;
  attempted: Array<{ path: string; hash: string }>;
}

export interface KnowledgeWriteResult {
  path: string;
  action: "create" | "update";
  /** 页面之前所在路径(更新时若换了位置)。 */
  movedFrom?: string;
}

export class KnowledgeService {
  /**
   * bundle 根目录。**宿主传入**,不在这一层拼默认路径 —— 默认位置属于产品决定。
   * (写成显式字段而不是构造器参数属性:本仓开了 `erasableSyntaxOnly`,参数属性不被允许。)
   */
  /** bundle 根。加工会话拿它当自己的会话根 —— 见 `PromptSessionOptions.sessionRootPath`。 */
  readonly root: string;
  private readonly onChange: (() => void) | undefined;
  /**
   * 失败记录的存放目录。**在 bundle 之外**:一份知识库应该是能带走的纯内容,而失败计数是
   * 这台机器的记账(见 `knowledge-failures.ts` 的文件头)。丢了它只会多试几次。
   */
  private readonly stateDirectory: string | undefined;
  /** 每轮的文件数上限,**懒读**(设置随时可能改)。`0` = 不限。 */
  private readonly readBudget: () => number;

  constructor(
    root: string,
    options: { onChange?: () => void; stateDirectory?: string; readBudget?: () => number } = {},
  ) {
    this.root = root;
    this.onChange = options.onChange;
    this.stateDirectory = options.stateDirectory;
    this.readBudget = options.readBudget ?? (() => 0);
  }

  get bundleRoot(): string {
    return this.root;
  }

  /** 建出 bundle 的骨架。幂等:每次加工前调用都安全。 */
  async ensureBundle(): Promise<void> {
    for (const directory of [KNOWLEDGE_RAWS_DIR, KNOWLEDGE_SOURCES_DIR, KNOWLEDGE_CONCEPTS_DIR, KNOWLEDGE_ENTITIES_DIR]) {
      await mkdir(join(this.root, directory), { recursive: true });
    }
  }

  /** 列出 `raws/` 下的原始文件(bundle 相对 posix 路径),按路径排序。 */
  async listRawFiles(): Promise<string[]> {
    const base = join(this.root, KNOWLEDGE_RAWS_DIR);
    const files = await walkFiles(base);
    return files.map((file) => toPosix(relative(base, file))).sort((a, b) => a.localeCompare(b));
  }

  /** 原始文件的内容 hash —— 增量加工的内容身份。 */
  async hashRawFile(relativePath: string): Promise<string> {
    const bytes = await readFile(join(this.root, KNOWLEDGE_RAWS_DIR, relativePath));
    return createHash("sha256").update(bytes).digest("hex");
  }

  /**
   * 扫全部页面。
   *
   * 解析失败的文件进 `damaged` 而不是抛异常:手改坏了、写到一半崩了都会造成这种文件,
   * 而**一个坏页不该让整个知识库不可用**(open-vetta 的教训:坏页要能被看见,
   * 否则它的源文件会永远静默显示"未加工")。
   */
  async scanPages(): Promise<KnowledgeScan> {
    const entries: KnowledgePageEntry[] = [];
    const damaged: Array<{ path: string; issue: string }> = [];
    for (const directory of [KNOWLEDGE_SOURCES_DIR, KNOWLEDGE_CONCEPTS_DIR, KNOWLEDGE_ENTITIES_DIR]) {
      const base = join(this.root, directory);
      for (const file of await walkFiles(base)) {
        if (!file.endsWith(".md")) continue;
        const path = toPosix(relative(this.root, file));
        let markdown: string;
        try {
          markdown = await readFile(file, "utf-8");
        } catch (error) {
          damaged.push({ path, issue: `读不了:${messageOf(error)}` });
          continue;
        }
        const parsed = parseKnowledgePage(markdown);
        if (!parsed.ok) {
          damaged.push({ path, issue: parsed.issues.map((issue) => issue.message).join(";") });
          continue;
        }
        entries.push({ path, page: parsed.page, body: parsed.body });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { entries, damaged };
  }

  /** 读一个页面的正文(给"改一页"用)。 */
  /**
   * 预览一页:正文 + 解析出来的元信息。
   *
   * **坏页也要能预览** —— 恰恰是坏页最需要看("它到底哪儿坏了")。所以解析失败时照样把
   * 原始正文给出去,只把 frontmatter 留空。
   */
  async pageContent(relativePath: string): Promise<{ path: string; body: string } | null> {
    const path = normalizePagePath(relativePath);
    const raw = await readFile(join(this.root, path), "utf-8").catch(() => undefined);
    if (raw === undefined) return null;
    const parsed = parseKnowledgePage(raw);
    return { path, body: parsed.ok ? parsed.body : raw };
  }

  async readPageBody(relativePath: string): Promise<string | undefined> {
    try {
      const parsed = parseKnowledgePage(await readFile(join(this.root, relativePath), "utf-8"));
      return parsed.ok ? parsed.body : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 写一个页面(新建或就地更新)。
   *
   * 路径校验在**这里**再做一次,而不是只信工具层:`raws/**` 与工程生成的两个文件不许写。
   * 校验放两层不冗余 —— 工具层管"模型看不到这条路",服务层管"这条路根本不存在"。
   */
  async writePage(request: KnowledgeWriteRequest): Promise<KnowledgeWriteResult> {
    const path = normalizePagePath(request.path);
    if (!isWritablePagePath(path)) {
      throw new Error(`${request.path} 不是可写的页面路径(页面只能写在 sources/ concepts/ entities/ 下)`);
    }
    const expectedType = directoryOf(path);
    if (KNOWLEDGE_TYPE_DIRECTORIES[request.type] !== expectedType) {
      throw new Error(`type 是 ${request.type},但它要写到 ${expectedType}/ —— 类型必须与目录一致`);
    }

    const absolute = join(this.root, path);
    const existing = await readFile(absolute, "utf-8").catch(() => undefined);
    const previous = existing === undefined ? undefined : parseKnowledgePage(existing);

    // **人工复核过的页不自动改写。** 这是一条承诺,不是提示词约定:同类实现明说过它们的
    // `recompile` 会覆盖手工编辑,而我们在这里把它堵死 —— 报给用户,让他自己决定。
    if (previous?.ok === true && isHumanVerified(previous.page)) {
      throw new Error(
        `${path} 是人工复核过的页(verified by ${previous.page.verified?.by}),不自动改写。` +
          `把你要改的内容报给用户,由他决定;或者先在知识库视图里取消复核。`,
      );
    }

    const previousPage = previous?.ok === true ? previous.page : undefined;
    /**
     * **省略 = 保留,传 `[]` = 显式清空。** 与机器位同一条规则,而且同样是被测试逼出来的:
     * 人在界面上改一页时不会带 `sources`,丢掉它的后果是那一页失去来源 —— 而来源正是
     * 孤儿回收时"摘引用而不是删整页"的依据(见 `withoutSourceReference`)。
     */
    // 来源路径统一成 bundle 相对形状(`raws/x` → `/raws/x`)。**归一而不是拒绝**:意思没有歧义,
    // 而写错的后果很隐蔽 —— 那一页的来源与原文的规范形状对不上,diff 就永远认为它的原文"没加工过"
    // (用户看到的是"Not processed yet"一直不消失)。导入路径早就这么归一了,这里是同一个约定。
    const sources = (request.sources ?? previousPage?.sources)?.map((source) => ({
      ...source,
      resource: canonicalSourceResource(source.resource),
    }));

    const page: KnowledgePage = {
      type: request.type,
      title: request.title,
      description: request.description,
      tags: request.tags,
      // 已有页保留它原来的 status(人审过的 stable 不该被一次自动写入降级)。
      ...(previousPage?.status === undefined ? {} : { status: previousPage.status }),
      ...(sources === undefined || sources.length === 0 ? {} : { sources }),
      generated: { by: request.by, at: request.now },
      // **机器位由我们维护,调用方没给就保留原来的。**
      //
      // 这一条是测试逼出来的:人在界面上改一页时不会带 `source_hash`(他不知道有这回事),
      // 而丢掉它的后果很重 —— 那一页会从 diff 里消失,它的原始文件下一轮被判成"新增",
      // 于是 agent 建出一个重复页。
      //
      // `orphaned_at` 一律归零:**写入即复活**。这也是"回收宽限期"能救回页面的机制 ——
      // 孤儿在被物理删除之前,任何人(或 agent)写它一次就把它救回来了。
      ...(request.sourceHash !== undefined || previousPage?.private !== undefined
        ? {
            private: {
              ...previousPage?.private,
              ...(request.sourceHash === undefined ? {} : { source_hash: request.sourceHash }),
              orphaned_at: null,
            },
          }
        : {}),
    };

    // **Source 页必须带真实的内容 hash。**
    //
    // 一条 Source 页的身份就是"它对应哪份原文、那份原文的哪一版" —— diff 全靠它认。少了它或
    // 编一个,后果不是报错而是**静默**:原文永远显示"没加工过",下一轮再写一遍(页越写越重复)。
    // 而 agent 没有 bash,算不出 sha256,所以报错必须**把正确的值给它**。
    //
    // 原文不存在时(比如导入了一份缺 raws/ 的库)不校验 —— 那时没有可比的东西。
    if (page.type === "Source") {
      const rawPath = rawPathOf(page.sources?.[0]?.resource);
      const actual = rawPath === undefined ? undefined : await this.hashRawFile(rawPath).catch(() => undefined);
      if (actual !== undefined) {
        const provided = page.private?.source_hash;
        if (provided === undefined || provided === "") {
          throw new Error(`Source 页必须带 sourceHash(${rawPath} 的内容 hash)。正确值是 ${actual}`);
        }
        if (provided !== actual) {
          throw new Error(
            `sourceHash 与 ${rawPath} 当前内容不一致(原文可能在你读它之后变过)。正确值是 ${actual}`,
          );
        }
      }
    }

    const serialized = serializeKnowledgePage(page, request.body);
    /**
     * **写出来的东西必须读得回来。**
     *
     * 用读侧同一套规则校验一遍再落盘 —— 这不是多余的重复,而是关掉一整类 bug:写入放过了
     * 读侧不接受的值,页面就"生下来就是坏的"(界面上显示成坏页、原文永远显示未加工),
     * 而写入那一刻没有任何信号。实测踩过:`sourceHash: ""` 被接受、写进了 frontmatter,
     * 直到下一轮读回来才报 `x-wordless.source_hash 必须是非空字符串`。
     *
     * 报的是读侧的原话,所以 agent 看到的就是它需要改的那一点。
     */
    const reparsed = parseKnowledgePage(serialized);
    if (!reparsed.ok) {
      throw new Error(`这一页不符合页面格式,没有写入:${reparsed.issues.map((issue) => issue.message).join(";")}`);
    }

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, serialized, "utf-8");
    // 通知界面:agent 在会话里写页时,知识库视图要跟着动(否则它显示的是打开那一刻的状态)。
    this.onChange?.();
    return { path, action: existing === undefined ? "create" : "update" };
  }

  /**
   * 退役一页:标成孤儿 + deprecated,**不立刻删**。
   *
   * Lint 判定一页是重复页/过期页时用它。为什么不直接删:
   *   - **宽限期**:下一轮才回收,中间那一轮里任何人都能写它一次把它救回来(写入即复活);
   *   - **引用自动清理**:回收时摘掉别处对它的 `sources[]` 引用(而不是留下死引用)。
   *
   * 拒绝退役**人工复核过**的页 —— 与回收那条同一条纪律:一个人为它背书过,agent 不能
   * 单方面让它消失。
   */
  async retirePage(relativePath: string, now: string): Promise<void> {
    const absolute = join(this.root, relativePath);
    const existing = await readFile(absolute, "utf-8").catch(() => undefined);
    if (existing === undefined) throw new Error(`${relativePath} 不存在`);
    const parsed = parseKnowledgePage(existing);
    if (!parsed.ok) throw new Error(`${relativePath} 读不出来:${parsed.issues.map((issue) => issue.message).join(";")}`);
    if (isHumanVerified(parsed.page)) {
      throw new Error(`${relativePath} 是人工复核过的页,不能退役。把理由报给用户,由他决定。`);
    }
    await writeFile(
      absolute,
      serializeKnowledgePage(
        {
          ...parsed.page,
          status: "deprecated",
          private: { ...parsed.page.private, orphaned_at: now },
          generated: { by: parsed.page.generated?.by ?? "wordless/lint", at: now },
        },
        parsed.body,
      ),
      "utf-8",
    );
    this.onChange?.();
  }

  /** 体检:把全库读一遍,算出**确定能算**的那些问题(死链、孤立页、无来源、标题撞车)。 */
  async healthReport(): Promise<KnowledgeHealthReport> {
    const { entries } = await this.scanPages();
    return buildHealthReport(
      entries.map((entry) => ({
        path: entry.path,
        kind: entry.page.type,
        title: entry.page.title,
        body: entry.body,
        orphaned: entry.page.private?.orphaned_at != null,
        verified: isHumanVerified(entry.page),
        sources: (entry.page.sources ?? []).map((source) => source.resource),
      })),
    );
  }

  /**
   * 标记/取消一页的人工复核。
   *
   * **这是用户的动作,不是内容改写** —— 所以它绕过 `writePage` 里那条"不自动改写复核过的页"
   * 的限制(那条限制拦的是 agent)。正文与其它 frontmatter 字段一律不动。
   */
  async setPageVerification(relativePath: string, verified: boolean, now: string): Promise<void> {
    const absolute = join(this.root, relativePath);
    const existing = await readFile(absolute, "utf-8").catch(() => undefined);
    if (existing === undefined) throw new Error(`${relativePath} 不存在`);
    const parsed = parseKnowledgePage(existing);
    if (!parsed.ok) throw new Error(`${relativePath} 读不出来:${parsed.issues.map((issue) => issue.message).join(";")}`);
    const page: KnowledgePage = { ...parsed.page };
    if (verified) page.verified = { by: "human:local", at: now };
    else delete page.verified;
    await writeFile(absolute, serializeKnowledgePage(page, parsed.body), "utf-8");
    this.onChange?.();
  }

  /**
   * **把一页从"待回收"里救回来。**
   *
   * 三件事一起做,因为它们说的是同一句话("这一页我要留着"):
   *   1. 清掉 `orphaned_at` —— 它不再是待回收的;
   *   2. 去掉 `deprecated` —— 退役是被自动回收的**理由**,留着一个理由是自相矛盾;
   *   3. **标成人工复核** —— 这是"人工背书"的既有语义,也是让这一页**顶住下一轮**的机制:
   *      回收会跳过复核页(见 `reapOrphans`),孤儿标记也会跳过它(见 `prepareRound`)。
   *      只清标记而不背书的话,原文已删的那种下一轮又会被标回来 —— 救不回来。
   */
  async restorePage(relativePath: string, now: string): Promise<void> {
    const absolute = join(this.root, relativePath);
    const existing = await readFile(absolute, "utf-8").catch(() => undefined);
    if (existing === undefined) throw new Error(`${relativePath} 不存在`);
    const parsed = parseKnowledgePage(existing);
    if (!parsed.ok) throw new Error(`${relativePath} 读不出来:${parsed.issues.map((issue) => issue.message).join(";")}`);
    const { orphaned_at: _dropped, ...rest } = parsed.page.private ?? {};
    const page: KnowledgePage = {
      ...parsed.page,
      verified: { by: "human:local", at: now },
      ...(parsed.page.status === "deprecated" ? { status: undefined } : {}),
      ...(Object.keys(rest).length === 0 ? { private: undefined } : { private: rest }),
    };
    await writeFile(absolute, serializeKnowledgePage(page, parsed.body), "utf-8");
    this.onChange?.();
  }

  /**
   * 回收一页:**先摘掉别处对它的引用,再删掉它**。
   *
   * 返回 `true` = 删了,`false` = 人工复核过,不删。
   *
   * 抽成一个方法是因为**它有两个调用点**:定时的 n+1 回收,和用户在「待回收」里点"立即删除"。
   * 两处各写一遍"摘引用 + 删"迟早会漂 —— 而漏掉摘引用会让别的页留下指向不存在页的来源。
   */
  private async reapPage(pagePath: string, rawResource: string | null, now: string): Promise<boolean> {
    // 人工复核过的页**不删**:一个人为它背书过,它不该被删掉。报出来。
    const parsed = parseKnowledgePage(await readFile(join(this.root, pagePath), "utf-8").catch(() => ""));
    if (parsed.ok && isHumanVerified(parsed.page)) return false;

    await this.deletePage(pagePath);
    // 摘掉别处对它的引用 —— **不删整页**:一个概念页可能综合了五份资料,
    // 少一份来源不该让整页消失(它变成"少了一条来源")。
    //
    // 摘的是**指向这一页自己的**引用(它的 bundle 路径),不是它自己的来源 ——
    // 后者是"这一页从哪来",拿它去别处找会把无关的 `sources` 删掉(测试抓到过这个)。
    // 正文里的链接**不动**:改散文是 agent 的事,而残留的死链正好由下一次体检报出来。
    //
    // 摘两种引用:
    //   - **指向这一页自己的**(`/concepts/x.md`)—— 任何页都可能引用任何页;
    //   - **源页对应的原始文件**(`/raws/x.pdf`)—— 只有源页有,因为只有它代表一个原始文件。
    //     概念页**不能**按它的 `sources[0]` 去摘:那会删掉别处对某个无关原始文件的引用
    //     (测试抓到过这个)。
    const targets = [toBundleResource(pagePath), ...(rawResource === null ? [] : [rawResource])];
    const { entries } = await this.scanPages();
    for (const entry of entries) {
      if (entry.page.type === "Source") continue;
      const target = targets.find((candidate) => (entry.page.sources ?? []).some((source) => source.resource === candidate));
      if (target === undefined) continue;
      const { page, removed } = withoutSourceReference(entry.page, target);
      if (!removed) continue;
      await this.writePage({
        path: entry.path,
        type: page.type,
        title: page.title,
        description: page.description,
        tags: page.tags,
        // **最后一条来源被摘掉时要显式传 `[]`。** 省略的语义是"保留原来的"(见 writePage),
        // 所以省略会把刚摘掉的那条又装回去 —— 摘最后一条等于没摘(测试抓到过)。
        ...(page.sources === undefined ? { sources: [] } : { sources: page.sources }),
        body: (await this.readPageBody(entry.path)) ?? "",
        by: "wordless/round",
        now,
      });
    }
    return true;
  }

  /**
   * 用户在「待回收」里点**立即删除**:不等宽限期,现在就走回收那一步。
   *
   * 与定时回收走**同一个实现**(`reapPage`),所以"摘引用"不会漏。
   * 两道闸:**只对已经标了孤儿的页**开放(界面也只在那里给按钮),**复核过的一律不删**。
   */
  async deleteOrphanNow(relativePath: string, now: string): Promise<void> {
    const path = normalizePagePath(relativePath);
    const parsed = parseKnowledgePage(await readFile(join(this.root, path), "utf-8").catch(() => ""));
    if (!parsed.ok) throw new Error(`${relativePath} 读不出来:${parsed.issues.map((issue) => issue.message).join(";")}`);
    if (parsed.page.private?.orphaned_at == null) {
      throw new Error(`${relativePath} 不是待回收的页 —— 回收只对已经标了孤儿的页开放`);
    }
    if (!(await this.reapPage(path, parsed.page.sources?.[0]?.resource ?? null, now))) {
      throw new Error(`${relativePath} 是人工复核过的页,不删。先取消复核再删。`);
    }
    this.onChange?.();
  }

  /**
   * **清空整理结果,保留原始文件。**
   *
   * 这是"整理得不对,我想让它重来"的出口 —— 而它与**删库**是两件不同的事:
   * 删库会把 `raws/` 里用户的原件一起删掉,而这里只删派生物,原件还在,下一轮会重新加工。
   *
   * 三件事要**说清**再动手(调用方负责说,这里负责算):
   *   - **没有原文的页会永久消失**:导入来的页(那份库缺 `raws/`)没有可以重新加工的原件;
   *   - **概念页/实体页不会自动重建**:它们是跨源综合出来的,重建与否是 agent 的判断;
   *   - **人工复核过的页也在被清之列**:这是用户主动要求清空,不是自动改写 —— 但得报出来。
   *
   * 清的是**派生层**:`sources/` `concepts/` `entities/` 与 `index.md` / `log.md`。
   * `raws/` 一根不动。
   */
  /** 清空会失去什么 —— **先看再清**(与导入那份同一套)。 */
  async clearPlan(): Promise<{ pages: number; withoutRaw: number; verified: number }> {
    const { entries } = await this.scanPages();
    const raws = new Set((await this.listRawFiles()).map((path) => toBundleResource(join(KNOWLEDGE_RAWS_DIR, path))));
    let withoutRaw = 0;
    let verified = 0;
    for (const entry of entries) {
      if (isHumanVerified(entry.page)) verified += 1;
      const sources = entry.page.sources ?? [];
      if (sources.length === 0 || !sources.some((source) => raws.has(source.resource))) withoutRaw += 1;
    }
    return { pages: entries.length, withoutRaw, verified };
  }

  async clearDerivedPages(): Promise<{ pages: number; withoutRaw: number; verified: number }> {
    const { entries } = await this.scanPages();
    const raws = new Set((await this.listRawFiles()).map((path) => toBundleResource(join(KNOWLEDGE_RAWS_DIR, path))));
    let withoutRaw = 0;
    let verified = 0;
    for (const entry of entries) {
      if (isHumanVerified(entry.page)) verified += 1;
      // "没有原文" = 它一条来源都不指向现有的原始文件(导入来的页常常如此)。
      const sources = entry.page.sources ?? [];
      if (sources.length === 0 || !sources.some((source) => raws.has(source.resource))) withoutRaw += 1;
      await this.deletePage(entry.path);
    }
    await rm(join(this.root, KNOWLEDGE_INDEX_FILE), { force: true });
    await rm(join(this.root, KNOWLEDGE_LOG_FILE), { force: true });
    this.onChange?.();
    return { pages: entries.length, withoutRaw, verified };
  }

  /** 删一个页面(孤儿回收用)。 */
  async deletePage(relativePath: string): Promise<void> {
    await rm(join(this.root, relativePath), { force: true });
  }

  /**
   * 重建 `index.md`。**每次加工后调用** —— 它是 frontmatter 的函数,所以随时可以从零重建,
   * 不存在"增量维护漂了"的问题。
   */
  async rebuildIndex(): Promise<void> {
    const { entries } = await this.scanPages();
    const pageSources = new Set(
      entries
        .filter((entry) => entry.page.private?.orphaned_at == null)
        .flatMap((entry) => (entry.page.sources ?? []).map((source) => source.resource)),
    );
    // "还没加工的原始文件" = raws 里没有对应源页的。
    const pending = (await this.listRawFiles()).filter((path) => !pageSources.has(toBundleResource(join(KNOWLEDGE_RAWS_DIR, path))));
    await writeFile(join(this.root, KNOWLEDGE_INDEX_FILE), buildKnowledgeIndex(entries, pending), "utf-8");
  }

  /** 追加一条 `log.md`。 */
  async appendLog(entry: { at: string; kind: KnowledgeLogKind; text: string }): Promise<void> {
    const path = join(this.root, KNOWLEDGE_LOG_FILE);
    const existing = await readFile(path, "utf-8").catch(() => "");
    await writeFile(path, appendKnowledgeLog(existing, entry), "utf-8");
  }

  /**
   * 界面的快照:投递箱里有什么、哪些还没加工、页面有哪些、哪些页坏了。
   *
   * "哪些原始文件还没加工"= 没有**活页**的 `sources` 指向它。这个判断只在这里做一次,
   * 界面与 `index.md` 的"Not processed yet"因此不会各说各话。
   */
  async snapshot(): Promise<{
    root: string;
    rawFiles: Array<{ path: string; processed: boolean; bytes: number }>;
    pages: Array<{
      path: string;
      kind: KnowledgePageType;
      title: string;
      description: string;
      tags: string[];
      orphaned: boolean;
      /** 见 `KnowledgePageSummary.status`。 */
      status?: KnowledgePageStatus;
      /** 人工复核过。 */
      verified: boolean;
      /** 复核**已过期**:复核过,但来源变了(只有源页会有)。界面据此提醒重新看一遍。 */
      reviewStale: boolean;
    }>;
    damaged: Array<{ path: string; issue: string }>;
  }> {
    const [{ entries, damaged }, raws] = await Promise.all([this.scanPages(), this.rawSnapshots()]);
    const live = entries.filter((entry) => entry.page.private?.orphaned_at == null);
    // 活页认领的来源(回答"这个文件加工过没有")。
    const claimed = new Set(live.flatMap((entry) => (entry.page.sources ?? []).map((source) => source.resource)));
    // **当前**原始文件的 hash(回答"复核过的那一页,它的来源还是复核时那一份吗")。
    // 注意是"当前文件的 hash",不是页面自己记的 hash —— 后者与自己比是恒等的,永远判不出过期。
    const currentRawHashes = new Map(raws.map((raw) => [raw.resource, raw.hash]));
    const rawFiles: Array<{ path: string; processed: boolean; bytes: number }> = [];
    for (const path of await this.listRawFiles()) {
      const bytes = await stat(join(this.root, KNOWLEDGE_RAWS_DIR, path)).then((info) => info.size).catch(() => 0);
      rawFiles.push({ path, processed: claimed.has(toBundleResource(join(KNOWLEDGE_RAWS_DIR, path))), bytes });
    }
    return {
      root: this.root,
      rawFiles,
      pages: entries.map((entry) => {
        const verified = isHumanVerified(entry.page);
        const resource = entry.page.sources?.[0]?.resource;
        const hash = entry.page.private?.source_hash;
        return {
          path: entry.path,
          kind: entry.page.type,
          title: entry.page.title,
          description: entry.page.description,
          tags: entry.page.tags,
          orphaned: entry.page.private?.orphaned_at != null,
          ...(entry.page.status === undefined ? {} : { status: entry.page.status }),
          verified,
          // 复核过期 = 复核过,而它对应的原始文件已经不是复核时那一份了。
          // 只对源页有意义(概念页没有单一来源,它的"过期"由人工判断)。
          reviewStale: verified && resource !== undefined && hash !== undefined && currentRawHashes.get(resource) !== hash,
        };
      }),
      damaged,
    };
  }

  /**
   * 把文件放进投递箱(复制或移动)。
   *
   * **绝不覆盖 `raws/` 里已有的文件。** 这是"原始文件不可变"的第一道门:同名时改成一个带序号
   * 的新名字,而不是盖掉旧的 —— 盖掉意味着某个页面的来源悄悄换了内容,而它的 `source_hash`
   * 还指着旧内容,于是下一轮加工会读出一个与页面不一致的原文。
   *
   * 返回导入了几个、以及被跳过的(不是文件、读不了)。跳过要说出来,不能静默。
   */
  async importFiles(sourcePaths: string[], mode: "copy" | "move"): Promise<{ imported: number; skipped: string[] }> {
    await this.ensureBundle();
    const skipped: string[] = [];
    let imported = 0;
    for (const sourcePath of sourcePaths) {
      const info = await stat(sourcePath).catch(() => undefined);
      if (!info?.isFile()) {
        skipped.push(sourcePath);
        continue;
      }
      const destination = await this.freeRawPath(sourcePath);
      try {
        if (mode === "move") await rename(sourcePath, destination);
        else await copyFile(sourcePath, destination);
        imported += 1;
      } catch {
        // 移动跨卷会失败(rename 不能跨设备),退回复制 + 删源 —— 但只在确实复制成功之后。
        if (mode === "move") {
          try {
            await copyFile(sourcePath, destination);
            await rm(sourcePath, { force: true });
            imported += 1;
            continue;
          } catch {
            /* 落到 skipped */
          }
        }
        skipped.push(sourcePath);
      }
    }
    if (imported > 0) this.onChange?.();
    return { imported, skipped };
  }

  /** 在 `raws/` 里给一个源文件找一个不冲突的落点(同名就加序号,永不覆盖)。 */
  private async freeRawPath(sourcePath: string): Promise<string> {
    const base = basename(sourcePath);
    const extension = extname(base);
    const stem = extension === "" ? base : base.slice(0, -extension.length);
    const directory = join(this.root, KNOWLEDGE_RAWS_DIR);
    for (let index = 1; ; index += 1) {
      const name = index === 1 ? base : `${stem} (${index})${extension}`;
      const candidate = join(directory, name);
      if (!(await stat(candidate).then(() => true).catch(() => false))) return candidate;
    }
  }

  /** 从扫描到的页面里取出源页快照 —— diff 的基线,**现算,不读缓存**。 */
  async sourcePageSnapshots(): Promise<SourcePageSnapshot[]> {
    const { entries } = await this.scanPages();
    const snapshots: SourcePageSnapshot[] = [];
    for (const entry of entries) {
      if (entry.page.type !== "Source") continue;
      const resource = entry.page.sources?.[0]?.resource;
      const hash = entry.page.private?.source_hash;
      // 缺 resource 或缺 hash 的源页参与不了 diff(手改坏了、或不是这一版写的)。
      // 跳过它们而不是猜一个值:猜错会让整库每一轮都被判成"全变了"。
      if (resource === undefined || hash === undefined) continue;
      snapshots.push({
        pagePath: entry.path,
        resource,
        hash,
        orphanedAt: entry.page.private?.orphaned_at ?? null,
        verified: isHumanVerified(entry.page),
      });
    }
    return snapshots;
  }

  /** 扫投递箱并算每个文件的内容 hash。 */
  async rawSnapshots(): Promise<RawSnapshot[]> {
    const raws: RawSnapshot[] = [];
    for (const path of await this.listRawFiles()) {
      raws.push({ path, resource: rawsResource(path), hash: await this.hashRawFile(path) });
    }
    return raws;
  }

  /**
   * 准备一轮加工:算 diff、做**工程侧**的动作、给出交给 agent 的待办。
   *
   * 工程侧动作(不烧 token):
   *   - `moved`:只改页面的 `sources[].resource` —— 内容没变,不该重读一遍原文;
   *   - `deleted`:给页标 `orphaned_at`(宽限期开始);
   *   - 回收:物理删除**上一轮或更早**标的孤儿,并摘掉其它页面对它的引用。
   *
   * 交给 agent 的只有 `added` 与 `changed`(要读原文、要写页)。
   */
  async prepareRound(now: string): Promise<KnowledgeRoundPlan> {
    await this.ensureBundle();
    const prior = await this.sourcePageSnapshots();
    const raws = await this.rawSnapshots();
    const diff = diffKnowledge(prior, raws);

    // 工程侧第一步:移动 = 纯元数据更新。
    for (const move of diff.moved) {
      await this.rewriteSourcePage(move.pagePath, (page) => ({
        ...page,
        sources: [{ ...(page.sources?.[0]?.id === undefined ? {} : { id: page.sources[0].id }), resource: move.to }],
      }), now);
    }

    /**
     * 人工复核过的页**不再被标孤儿,也不再催 agent 处理**。
     *
     * 用户为它背过书 = "这一页我要留着" —— 而标孤儿是回收的第一步,催 agent 处理是把
     * 它往合并/重指的方向推。两者都与那句背书相反。回收那一侧本来就会跳过复核页
     * (`reapOrphans`),这里补上的是**上游**:别先把标记打上去。
     */
    const backedByHuman = new Set(prior.filter((page) => page.verified).map((page) => page.pagePath));
    const deleted = diff.deleted.filter((gone) => !backedByHuman.has(gone.pagePath));
    // 工程侧第二步:本轮新删除 → 标孤儿(不是立刻删)。
    for (const gone of deleted) {
      await this.rewriteSourcePage(gone.pagePath, (page) => ({ ...page, status: "deprecated", private: { ...page.private, orphaned_at: now } }), now);
    }

    // 工程侧第三步:回收上一轮(或更早)标的孤儿,并摘掉别处对它的引用。
    // 到期的孤儿从**全量页**里算(不只源页):概念页也会被退役,见 reapOrphans。
    const allPages = (await this.scanPages()).entries.map((entry) => ({
      pagePath: entry.path,
      // 只有**源页**代表一个原始文件,所以只有它能按 raw 摘引用。
      rawResource: entry.page.type === "Source" ? (entry.page.sources?.[0]?.resource ?? null) : null,
      orphanedAt: entry.page.private?.orphaned_at ?? null,
    }));
    const { reaped, keptForReview } = await this.reapOrphans(planOrphanReaping(allPages, now), now);

    // 止损:隔离的文件不再进待办,但要如实报出来。
    const failures = await this.readFailures();
    const currentHashes = new Map(raws.map((raw) => [raw.path, raw.hash]));
    const quarantined = quarantinedPaths(failures, currentHashes);
    const gated = applyQuarantine({ ...diff, deleted }, quarantined);
    // 复核闸门:人工复核过的页不进 agent 的待办(见 `applyVerificationGate`)。
    const reviewed = applyVerificationGate(gated.diff, new Set(prior.filter((page) => page.verified).map((page) => page.pagePath)));
    // 账本只留仍然存在的文件。
    const pruned = pruneFailures(failures, currentHashes);
    if (JSON.stringify(pruned) !== JSON.stringify(failures)) await this.writeFailures(pruned);

    // 预算:一轮最多加工 N 个文件,超出的留给下一轮。
    //
    // 不需要游标:**下一轮重算 diff 时,没加工的文件仍然是"新增"**(它的页还不存在),
    // 所以"剩下多少"是自愈的。这也是为什么这里只截断、不记账。
    const budget = Math.max(0, Math.floor(this.readBudget()));
    const total = reviewed.diff.added.length + reviewed.diff.changed.length;
    const added = budget > 0 ? reviewed.diff.added.slice(0, budget) : reviewed.diff.added;
    const changed = budget > 0 ? reviewed.diff.changed.slice(0, Math.max(0, budget - added.length)) : reviewed.diff.changed;
    const deferred = total - added.length - changed.length;
    const budgeted: KnowledgeDiff = { ...reviewed.diff, added, changed };

    return {
      diff: budgeted,
      deferred,
      skipped: gated.skipped,
      reaped,
      needsReview: [...reviewed.needsReview, ...keptForReview],
      empty: isDiffEmpty(budgeted) && reaped.length === 0 && reviewed.needsReview.length === 0,
      needsProcessing: diffNeedsProcessing(budgeted),
      /** 本轮真的尝试过的文件(轮末对账用)。 */
      attempted: [
        ...gated.diff.added.map((raw) => ({ path: raw.path, hash: raw.hash })),
        ...gated.diff.changed.map((change) => ({
          path: change.resource.replace(/^\/raws\//, ""),
          hash: change.newHash,
        })),
      ],
    };
  }

  /**
   * 轮末对账失败记录,并返回**这一轮实际写成了什么**。
   *
   * **被中止的轮次不要调用它** —— 中止不该算失败,也不该被记成产出。
   */
  async finishRound(plan: KnowledgeRoundPlan, now: string): Promise<KnowledgeRoundResult> {
    if (plan.attempted.length === 0) return { written: [], failed: [], gone: [] };
    const [{ entries }, raws, failures] = await Promise.all([this.scanPages(), this.rawSnapshots(), this.readFailures()]);
    const present = new Map(
      entries
        .filter((entry) => entry.page.type === "Source" && entry.page.private?.orphaned_at == null)
        .flatMap((entry) => {
          const path = entry.page.sources?.[0]?.resource.replace(/^\/raws\//, "");
          const hash = entry.page.private?.source_hash;
          return path === undefined || hash === undefined ? [] : [[path, hash] as const];
        }),
    );
    const current = new Map(raws.map((raw) => [raw.path, raw.hash]));
    await this.writeFailures(
      reconcileFailures({
        failures,
        attempted: plan.attempted,
        present,
        current,
        now,
      }),
    );

    // 产出从**同一份对账数据**里取:写成了 = 页在、且 hash 与原文一致。
    // 与失败账本同源,所以两者不会各说各话。
    const written: string[] = [];
    const failed: string[] = [];
    const gone: string[] = [];
    for (const file of plan.attempted) {
      if (present.get(file.path) === file.hash) written.push(file.path);
      else if (current.has(file.path)) failed.push(file.path);
      // 原文已经被删了:它会走孤儿回收,不算失败。
      else gone.push(file.path);
    }
    return { written, failed, gone };
  }

  /** 物理删除上一轮(或更早)标的孤儿,并摘掉其它页面对它的引用。 */
  /**
   * 回收到期的孤儿。
   *
   * **覆盖所有页类型**,不只源页:概念页也可能被标成孤儿(原始文件删了、或者 Lint 判定它是
   * 重复页而被退役),它们同样要走"标 → 宽限一轮 → 回收"这条路。
   */
  private async reapOrphans(
    due: Array<{ pagePath: string; rawResource: string | null }>,
    now: string,
  ): Promise<{ reaped: Array<{ pagePath: string; resource: string }>; keptForReview: Array<{ pagePath: string; resource: string }> }> {
    if (due.length === 0) return { reaped: [], keptForReview: [] };
    const reaped: Array<{ pagePath: string; resource: string }> = [];
    const keptForReview: Array<{ pagePath: string; resource: string }> = [];
    for (const orphan of due) {
      const deleted = await this.reapPage(orphan.pagePath, orphan.rawResource, now);
      const resource = orphan.rawResource ?? "";
      if (deleted) reaped.push({ pagePath: orphan.pagePath, resource });
      else keptForReview.push({ pagePath: orphan.pagePath, resource });
    }
    return { reaped, keptForReview };
  }


  /** 就地改一个页面的 frontmatter(正文不动)。 */
  private async rewriteSourcePage(
    pagePath: string,
    update: (page: KnowledgePage) => KnowledgePage,
    now: string,
  ): Promise<void> {
    const absolute = join(this.root, pagePath);
    const existing = await readFile(absolute, "utf-8").catch(() => undefined);
    if (existing === undefined) return;
    const parsed = parseKnowledgePage(existing);
    if (!parsed.ok) return;
    const next = update(parsed.page);
    await writeFile(
      absolute,
      serializeKnowledgePage({ ...next, generated: { by: next.generated?.by ?? "wordless/round", at: now } }, parsed.body),
      "utf-8",
    );
    this.onChange?.();
  }

  /** 读失败记录(不存在 = 空账本)。 */
  async readFailures(): Promise<KnowledgeFailures> {
    if (this.stateDirectory === undefined) return EMPTY_KNOWLEDGE_FAILURES;
    const raw = await readFile(this.failuresPath(), "utf-8").catch(() => undefined);
    if (raw === undefined) return EMPTY_KNOWLEDGE_FAILURES;
    try {
      return normalizeKnowledgeFailures(JSON.parse(raw));
    } catch {
      // 账本坏了就当空的:它的唯一后果是"多试几次",不该让整轮失败。
      return EMPTY_KNOWLEDGE_FAILURES;
    }
  }

  async writeFailures(failures: KnowledgeFailures): Promise<void> {
    if (this.stateDirectory === undefined) return;
    await mkdir(this.stateDirectory, { recursive: true });
    await writeFile(this.failuresPath(), `${JSON.stringify(failures, null, 2)}\n`, "utf-8");
  }

  private failuresPath(): string {
    // 按 bundle 根分文件:多知识库时各记各的账(见设计文档 §13)。
    const key = createHash("sha256").update(this.root).digest("hex").slice(0, 16);
    return join(this.stateDirectory as string, `${key}.json`);
  }

  /**
   * 看一份**别人的 OKF bundle**:读它、映射、算撞车 —— 但**什么都不写**。
   *
   * 先看再导是刻意的:一份别人的库可能有几百页,盲目导进去之后才发现"撞了 40 页""少了原始文件",
   * 而那时已经在库里了。同类实现也把 `--dry-run` 当成默认动作。
   */
  async planImport(sourceDirectory: string): Promise<ImportPlan> {
    const bundle = await this.readBundle(sourceDirectory);
    const { entries } = await this.scanPages();
    return planImport(bundle, new Set(entries.map((entry) => entry.path)));
  }

  /**
   * 执行导入。**只新建,不覆盖** —— 撞车的页按 `onConflict` 处理:
   * `skip` 留本库那一页,`rename` 给来源那一页一个带序号的新路径。
   */
  async applyImport(
    sourceDirectory: string,
    onConflict: "skip" | "rename",
    now: string,
  ): Promise<{ imported: number; skipped: number; raws: number }> {
    const bundle = await this.readBundle(sourceDirectory);
    const { entries } = await this.scanPages();
    const taken = new Set(entries.map((entry) => entry.path));

    let imported = 0;
    let skipped = 0;
    for (const page of bundle.pages) {
      if (taken.has(page.path) && onConflict === "skip") {
        skipped += 1;
        continue;
      }
      const target = freeImportPath(page.path, taken);
      await mkdir(dirname(join(this.root, target)), { recursive: true });
      await writeFile(join(this.root, target), serializeKnowledgePage(page.page, page.body), "utf-8");
      taken.add(target);
      imported += 1;
    }

    // 原始文件一起带进来:少了它们,那些源页下一轮会被判成孤儿。
    let raws = 0;
    for (const rawPath of bundle.raws) {
      const destination = join(this.root, KNOWLEDGE_RAWS_DIR, rawPath);
      if (await stat(destination).then(() => true).catch(() => false)) continue;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(sourceDirectory, KNOWLEDGE_RAWS_DIR, rawPath), destination);
      raws += 1;
    }

    if (imported > 0 || raws > 0) this.onChange?.();
    await this.appendLog({ at: now, kind: "Creation", text: `导入:${imported} 页、${raws} 个原始文件(跳过 ${skipped} 页)` });
    return { imported, skipped, raws };
  }

  /** 读一份来源 bundle 的**内容**(不写任何东西)。 */
  private async readBundle(sourceDirectory: string): Promise<ImportedBundle> {
    const pageFiles: Array<{ path: string; markdown: string }> = [];
    for (const directory of [KNOWLEDGE_SOURCES_DIR, KNOWLEDGE_CONCEPTS_DIR, KNOWLEDGE_ENTITIES_DIR]) {
      for (const file of await walkFiles(join(sourceDirectory, directory))) {
        if (!file.endsWith(".md")) continue;
        const path = toPosix(relative(sourceDirectory, file));
        pageFiles.push({ path, markdown: await readFile(file, "utf-8").catch(() => "") });
      }
    }
    const rawsBase = join(sourceDirectory, KNOWLEDGE_RAWS_DIR);
    const rawPaths = (await walkFiles(rawsBase)).map((file) => toPosix(relative(rawsBase, file)));
    return readImportedBundle(pageFiles, rawPaths);
  }

  /** 库的基本事实(给"这个库现在什么样"用)。 */
  async stats(): Promise<{ rawFiles: number; pages: number; damaged: number; bytes: number }> {
    const [raws, scan] = await Promise.all([this.listRawFiles(), this.scanPages()]);
    let bytes = 0;
    for (const file of raws) {
      bytes += await stat(join(this.root, KNOWLEDGE_RAWS_DIR, file)).then((info) => info.size).catch(() => 0);
    }
    return { rawFiles: raws.length, pages: scan.entries.length, damaged: scan.damaged.length, bytes };
  }
}

/** 页面路径归一:补 `.md`、去前导 `/`、统一分隔符。 */
export function normalizePagePath(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".md")) normalized = `${normalized}.md`;
  return normalized;
}

async function walkFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const toPosix = (path: string): string => (sep === "/" ? path : path.split(sep).join(posix.sep));

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 来源路径的规范形状:`raws/x` / `raws\x` → `/raws/x`。别的值(URL、别的命名空间)原样留着 ——
 * OKF 允许 `sources[].resource` 是任意资源标识。
 */
function canonicalSourceResource(resource: string): string {
  const trimmed = resource.trim();
  const match = /^\/?raws[\\/](.+)$/i.exec(trimmed);
  return match === null ? trimmed : `/raws/${match[1]!.replace(/\\/g, "/")}`;
}

/** `/raws/x.md` → `x.md`(相对 raws/ 的路径);不是 raws 里的资源就是 undefined。 */
function rawPathOf(resource: string | undefined): string | undefined {
  return resource !== undefined && resource.startsWith("/raws/") ? resource.slice("/raws/".length) : undefined;
}
