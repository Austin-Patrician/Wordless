import { Button } from "@wordless/ui-kit";
import { AlertCircle, ArrowRight, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import brandIcon from "./icons/wordless-brand.svg";
import type { RemoteClientState } from "./remote-client";

/**
 * 配对页:手机上只需要输**连接码 + 密码**(电脑上显示的那两样),或者粘贴二维码里的文本。
 *
 * 它刻意做得像桌面端设置页里的那一块:同样的面板、同样的输入尺寸、同样的强调色。
 */
export function ConnectView({
	state,
	onPairWithCode,
	onPairWithQrText,
	onDisconnect,
}: {
	readonly state: RemoteClientState;
	readonly onPairWithCode: (input: { code: string; password: string }) => void;
	readonly onPairWithQrText: (text: string) => void;
	readonly onDisconnect: () => void;
}) {
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [qrText, setQrText] = useState("");
	const [mode, setMode] = useState<"code" | "qr">("code");
	const busy = state.phase === "pairing" || state.phase === "connecting";

	return (
		<div className="flex min-h-dvh items-center justify-center bg-background p-5">
			<section className="w-full max-w-[420px] rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm">
				<header className="mb-6">
					<div className="mb-3 flex items-center gap-2.5">
						<img src={brandIcon} alt="" aria-hidden className="h-9 w-9 rounded-[9px]" />
						<span className="text-[0.9rem] font-semibold text-card-foreground">Wordless 远程</span>
					</div>
					<div className="mb-2 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-[0.7rem] font-medium text-muted-foreground">
						<Link2 className="size-3.5" />
						远程连接
					</div>
					<h1 className="text-[1.35rem] font-semibold leading-tight text-card-foreground">连接你的电脑</h1>
					<p className="mt-1.5 text-[0.8rem] leading-relaxed text-muted-foreground">
						这一步需要先在电脑上取出连接码 —— 它不会出现在这个页面上,只能由你自己的电脑生成。
					</p>
					<ol className="mt-3 space-y-1.5 text-[0.78rem] leading-relaxed text-muted-foreground">
						<li className="flex gap-2">
							<span className="mt-[2px] grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[0.62rem] font-semibold text-muted-foreground">
								1
							</span>
							在电脑上打开 Wordless
						</li>
						<li className="flex gap-2">
							<span className="mt-[2px] grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[0.62rem] font-semibold text-muted-foreground">
								2
							</span>
							<span>
								设置 → <span className="font-medium text-foreground">远程连接</span> → 打开开关
							</span>
						</li>
						<li className="flex gap-2">
							<span className="mt-[2px] grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[0.62rem] font-semibold text-muted-foreground">
								3
							</span>
							<span>
								点 <span className="font-medium text-foreground">生成二维码</span>,把那里显示的连接码与密码填到这里
							(或者直接用手机相机扫那个二维码)
							</span>
						</li>
					</ol>
					<p className="mt-3 text-[0.72rem] leading-relaxed text-muted-foreground">
						连接码 10 分钟失效,而且只能用一次。会话与执行都留在你的电脑上,这条通道是端到端加密的。
					</p>
				</header>

				<div className="mb-5 flex gap-1 rounded-lg bg-muted p-1 text-[0.75rem]">
					<button
						type="button"
						onClick={() => setMode("code")}
						className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
							mode === "code" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
						}`}
					>
						连接码
					</button>
					<button
						type="button"
						onClick={() => setMode("qr")}
						className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
							mode === "qr" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
						}`}
					>
						粘贴配对码
					</button>
				</div>

				{mode === "code" ? (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							onPairWithCode({ code, password });
						}}
					>
						<label className="block">
							<span className="mb-1.5 block text-[0.72rem] font-medium text-muted-foreground">连接码</span>
							<input
								value={code}
								onChange={(event) => setCode(event.target.value)}
								placeholder="K7Q2-9MXD"
								autoCapitalize="characters"
								autoComplete="off"
								spellCheck={false}
								className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-[0.95rem] tracking-[0.18em] text-foreground uppercase outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
							/>
						</label>
						<label className="block">
							<span className="mb-1.5 block text-[0.72rem] font-medium text-muted-foreground">密码</span>
							<input
								value={password}
								onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 6))}
								inputMode="numeric"
								placeholder="000000"
								autoComplete="off"
								className="h-11 w-full rounded-lg border border-input bg-background px-3 font-mono text-[0.95rem] tracking-[0.3em] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
							/>
						</label>
						<Button type="submit" className="h-11 w-full text-[0.8rem]" disabled={busy}>
							{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
							{busy ? "正在连接…" : "连接"}
						</Button>
					</form>
				) : (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							onPairWithQrText(qrText);
						}}
					>
						<label className="block">
							<span className="mb-1.5 block text-[0.72rem] font-medium text-muted-foreground">配对码文本</span>
							<textarea
								value={qrText}
								onChange={(event) => setQrText(event.target.value)}
								rows={3}
								placeholder="WORDLESS://PAIR/K7Q29MXD/123456"
								spellCheck={false}
								className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[0.78rem] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
							/>
						</label>
						<Button type="submit" className="h-11 w-full text-[0.8rem]" disabled={busy}>
							{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
							{busy ? "正在连接…" : "连接"}
						</Button>
					</form>
				)}

				{state.error ? (
					<p className="mt-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-[0.75rem] leading-relaxed text-foreground">
						<AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
						{state.error}
					</p>
				) : null}

				{state.waitingForApproval ? (
					<p className="mt-4 text-[0.75rem] text-muted-foreground">等待电脑上放行这台设备…</p>
				) : null}

				<footer className="mt-6 border-t border-border pt-4 text-[0.7rem] leading-relaxed text-muted-foreground">
					连接码 8 位(不含 I、L、O、U),密码 6 位数字;两者只在电脑界面上显示。
					<button type="button" onClick={onDisconnect} className="ml-1 underline decoration-dotted hover:text-foreground">
						清除本机保存的配对
					</button>
				</footer>
			</section>
		</div>
	);
}
