/**
 * 封面的**本机**缓存。
 *
 * ## 为什么是"本机缓存",而不是写进设计包
 *
 * 封面是**索引用的缩略图**,不是设计内容。写进 `.wdesign` 会让包多一个二进制文件、导出时多一次
 * 光栅,而它的价值只体现在这台机器的这一页列表上 —— 换台机器重新生成一次就好。所以它住在渲染层
 * 的 IndexedDB 里(参考实现同样把封面放在本机的一个 `covers` 存储里,理由一致)。
 *
 * ## 三个"不做"
 *
 * - **不做失败处理**:写不进去(配额满、隐私模式禁用 IndexedDB)就是没有封面。调用方有兜底
 *   (卡片用设计主色刷底),而一个缓存失败**绝不该**让列表出错。
 * - **不做失效判断**:封面按设计路径存,重新打开这份设计会覆盖它。过期一秒的封面比"每次打开
 *   都重新生成"便宜得多。
 * - **不做并发去重**:同一份设计被两个地方同时写,后写的赢 —— 它们画的是同一张图。
 *
 * 内存里再镜像一份:列表渲染时一次要问几十个 key,每次都过一遍 IDB 的异步事务没有必要。
 */

const DATABASE = "wordless-design-covers";
const STORE = "covers";
const VERSION = 1;

/** 内存镜像。进程内只读一次,之后命中它。 */
const memory = new Map<string, string>();
/** 已经查过 IDB 的 key(命中或未命中都算) —— 未命中也要记住,否则每次渲染都再查一遍。 */
const probed = new Set<string>();
/** 正在查/正在写的 key,避免同一份设计被并发查两次。 */
const inFlight = new Map<string, Promise<string | null>>();

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, VERSION);
    } catch {
      // 隐私模式 / 被策略禁用:当作没有缓存。
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const database = await openDatabase();
  if (database === null) return null;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => database.close();
    } catch {
      resolve(null);
    }
  });
}

/**
 * 读一份封面。没有就返回 `null`(调用方用主色块兜底)。
 *
 * **同 key 并发只查一次**:列表一次要问几十个 key,而它们会在同一帧里一起发出去。
 */
export function readCover(designPath: string): Promise<string | null> {
  const cached = memory.get(designPath);
  if (cached !== undefined) return Promise.resolve(cached);
  if (probed.has(designPath)) return Promise.resolve(null);
  const pending = inFlight.get(designPath);
  if (pending !== undefined) return pending;

  const task = withStore<string | undefined>("readonly", (store) => store.get(designPath)).then((value) => {
    inFlight.delete(designPath);
    probed.add(designPath);
    if (typeof value === "string" && value !== "") {
      memory.set(designPath, value);
      return value;
    }
    return null;
  });
  inFlight.set(designPath, task);
  return task;
}

/** 写一份封面。失败什么也不做 —— 缓存不该把调用方拖下水。 */
export async function writeCover(designPath: string, dataUrl: string): Promise<void> {
  if (dataUrl === "") return;
  memory.set(designPath, dataUrl);
  probed.add(designPath);
  await withStore("readwrite", (store) => store.put(dataUrl, designPath)).catch(() => undefined);
}

/** 测试用:清掉内存镜像(否则一个用例写了封面,下一个用例会看到它)。 */
export function resetCoverCacheForTests(): void {
  memory.clear();
  probed.clear();
  inFlight.clear();
}
