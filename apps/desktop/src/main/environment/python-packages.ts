/**
 * 数据功能需要的第三方包 —— **pin 住版本,按需装,不内置**。
 *
 * 为什么不把 wheel 打进安装包(与 open-vetta 同一个结论,见 docs/architecture/host-environment.md):
 * 三个平台各 +55MB,而绝大多数用户永远用不到数据功能。所以:运行时内置,包按需 —— 用户点一次,
 * 从镜像装进**我们自己的** Python 里,不碰用户的系统环境。
 *
 * 三条纪律:
 * - **版本 pin 死**。不 pin 就等于每次装的东西不一样,而"昨天还能跑今天不能"是最难查的一类问题。
 * - **只装 wheel**(`--only-binary :all:`)。没有 wheel 的包要现场编译,而 Wordless 不带编译工具链
 *   (这是明确的边界,不是遗漏):与其让用户在编译错误里挣扎,不如当场说清"这个包没有预编译版本"。
 * - **镜像可配**。默认走清华(国内直连 pypi 常常不通);用户/企业要换源时改这一处即可。
 */

export interface PinnedPythonPackage {
  name: string;
  version: string;
  /** 谁需要它。写出来是为了让"为什么要装这 55MB"在代码里就有答案。 */
  requiredBy: string;
}

export const DATA_ANALYSIS_PYTHON_PACKAGES: readonly PinnedPythonPackage[] = [
  { name: "pandas", version: "2.3.3", requiredBy: "data-analysis (inspect / validate / materialize)" },
  // numpy 是 pandas 的依赖,但显式 pin 一遍:不 pin 的话解析结果会随镜像上的新版本漂移。
  { name: "numpy", version: "2.3.5", requiredBy: "pandas" },
  { name: "pyarrow", version: "22.0.0", requiredBy: "data-analysis (Parquet 落盘)" },
  { name: "openpyxl", version: "3.1.5", requiredBy: "data-analysis (.xlsx 读取)" },
];

/** 国内直连 pypi.org 常常不通,所以默认走清华镜像;`trustedHost` 是 pip 对 http 源的校验豁免。 */
export const PYTHON_PACKAGE_MIRROR = {
  indexUrl: "https://pypi.tuna.tsinghua.edu.cn/simple",
  trustedHost: "pypi.tuna.tsinghua.edu.cn",
} as const;

/** 给面板用的粗略体积(实测四个包合计;文案里说"约",不假装精确)。 */
export const PYTHON_PACKAGE_DOWNLOAD_MB = 56;

export function pinnedRequirements(packages: readonly PinnedPythonPackage[] = DATA_ANALYSIS_PYTHON_PACKAGES): string[] {
  return packages.map((entry) => `${entry.name}==${entry.version}`);
}
