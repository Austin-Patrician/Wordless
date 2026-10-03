/**
 * 远端附件的策略 —— **两端共用同一份**(网页端先拦,本机再拦一次)。
 *
 * 桌面端不挑类型,上限 50MB、一次 10 个:那是在自己的机器上、文件本来就在本地。
 * 手机不一样:文件要**穿过中继**、在内存里分片重组,而且手机上的"随便挑一个文件"往往
 * 是相册里几 MB 的照片。所以这里的限制单独定,并且**把理由说给用户听**。
 */

/** 单个文件上限:8MB。手机照片、PDF、文档都装得下,又不至于让内存里的分片失控。 */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
/** 一次最多几个:4 个。再多的话"这一轮到底在看哪些文件"就说不清了。 */
export const ATTACHMENT_MAX_FILES = 4;
/**
 * 分片大小(原始字节):256KB。
 *
 * 单帧上限是 1_500_000 字符,base64 之后膨胀约 4/3 —— 256KB → 约 341KB,留足余量。
 * 比它大就可能一帧装不下,而一帧装不下的后果是**整条链路被对端关掉**(踩过)。
 */
export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;
/** 没传完的附件留多久:10 分钟。过期就丢,免得内存里堆着半截文件。 */
export const ATTACHMENT_UPLOAD_TTL_MS = 10 * 60_000;

/**
 * 允许的类型(按扩展名)。
 *
 * **不是白名单洁癖**:手机上传会经过中继、落在会话目录里,而用户看不到它到底存成了什么。
 * 只放行"看得懂、也说得清"的那几类;可执行文件与压缩包一律拒 —— 那不是这一轮对话需要的东西。
 */
const ALLOWED_EXTENSIONS: readonly string[] = [
	// 图片
	"png", "jpg", "jpeg", "webp", "gif", "bmp",
	// 文档
	"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "odt", "ods", "odp",
	// 文本与代码
	"txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "xml", "html", "htm",
	"css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp",
	"cs", "php", "swift", "sh", "zsh", "sql", "toml", "ini", "log", "svg",
];

/** 文件扩展名(小写,不带点)。认不出来就是空串。 */
export function attachmentExtension(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	if (dot <= 0 || dot === base.length - 1) return "";
	return base.slice(dot + 1).toLowerCase();
}

export interface AttachmentRejection {
	readonly code: "too_large" | "too_many" | "unsupported_type" | "empty";
	/** 给用户看的一句话 —— 说明"为什么"和"怎么办"。 */
	readonly message: string;
}

/** 检查一个文件能不能发。通过返回 undefined。 */
export function checkAttachment(file: { readonly name: string; readonly size: number }): AttachmentRejection | undefined {
	if (!Number.isFinite(file.size) || file.size <= 0) {
		return { code: "empty", message: `「${file.name}」是空文件,没什么可发的。` };
	}
	if (file.size > ATTACHMENT_MAX_BYTES) {
		return {
			code: "too_large",
			message: `「${file.name}」超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB,手机上发不了这么大的文件。`,
		};
	}
	const extension = attachmentExtension(file.name);
	if (!ALLOWED_EXTENSIONS.includes(extension)) {
		return {
			code: "unsupported_type",
			message: extension.length === 0
				? `「${file.name}」看不出是什么类型,手机上只发图片、文档与文本。`
				: `手机上不发 .${extension} 这类文件(只发图片、文档与文本)。`,
		};
	}
	return undefined;
}

/** 检查一批文件(数量 + 逐个)。返回第一条拒绝理由。 */
export function checkAttachments(files: readonly { readonly name: string; readonly size: number }[]): AttachmentRejection | undefined {
	if (files.length > ATTACHMENT_MAX_FILES) {
		return {
			code: "too_many",
			message: `一次最多发 ${ATTACHMENT_MAX_FILES} 个文件(现在是 ${files.length} 个)。`,
		};
	}
	for (const file of files) {
		const rejection = checkAttachment(file);
		if (rejection) return rejection;
	}
	return undefined;
}

/** 分片数。空文件也会给 1 片(与本机校验里的"空文件"判断保持一致)。 */
export function attachmentChunkCount(size: number): number {
	return Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_BYTES));
}
