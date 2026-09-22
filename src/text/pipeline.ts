/**
 * 文本排版流水线：把各个纯函数排版步骤按固定顺序串起来。
 *
 * 顺序不是随便定的：
 * 1. **行首缩进**（indent.ts）—— 必须排在聊天记录排版**前面**。
 *    聊天记录排版会按「正文缩进」设置重新缩进每条消息的正文，
 *    放后面会把用户设置的"2/4 个空格缩进"又改成 Tab。
 * 2. **标记排版**（markers.ts）—— 排在标签排版前面，
 *    这样标签排版拿到的引用前缀已经是规范形态（`> `），缩进也不会再来回改。
 * 3. **聊天记录排版**（chat-log.ts）—— 认内容，重排每条消息的头部与正文。
 * 4. **列表序号整理**（list-numbering.ts）—— 排在聊天记录**后面**：
 *    列表的嵌套关系由缩进决定，而聊天记录排版会按「正文缩进」重排正文行，
 *    得等缩进定下来才知道哪些行属于同一个列表、谁是子列表。
 * 5. **标题级别整理**（heading-levels.ts）—— 排在标记排版**后面**（`#` 后的空白已规范），
 *    排在板块排序**前面**：板块排序拿标题当锚点，级别改了锚点还在。
 * 6. **智能公式**（math-wrap.ts）—— 把正文里的 `矩阵 A`、`n维`、`V(F)`、`x = 0` 这类写法
 *    套上 `$…$`。必须排在公式排版**前面**：新包出来的公式还要按 LaTeX 规则整理一遍。
 * 7. **公式排版**（latex.ts）—— 排在聊天记录**后面**：
 *    聊天记录排版会把正文行重新缩进，公式的多行缩进必须在它之后才定下来。
 * 8. **空格排版**（spacing/index.ts）—— 排在公式排版**后面**：
 *    先让 `$…$` 里的代码定型，再按规则决定公式与前后文字之间空不空格；
 *    它只管 `$` 外面，不会破坏"`$` 内侧紧贴内容"这条识别前提。
 * 9. **标签排版**（tags.ts）—— 排在聊天记录**后面**，
 *    聊天记录的正文行已经被重新缩进过，标签归位不会再被缩进修复挪动；
 *    `$$…$$` 公式整体跳过，`\textcolor{#fff}{…}` 里的 `#fff` 不会被当成标签。
 * 10. **内容板块排序**（block-sort.ts）—— 放最后：标签已经归位到块尾，
 *    排序键取的是块首的正文，不会受标签位置影响；公式整块当锚点，不会被拆散。
 *
 * 每一步都是幂等的纯函数，整条流水线因此也幂等：同一篇笔记连跑两次，
 * 第二次不会有任何改动，也就不会反复写盘。
 */
import { fixLeadingIndent } from './indent';
import type { LeadingIndentMode } from './indent';
import { fixBlockMarkers } from './markers';
import { formatChatLog } from './chat-log';
import type { ChatLogOptions } from './chat-log';
import { fixListNumbers } from './list-numbering';
import { fixHeadingLevels } from './heading-levels';
import { wrapPlainMath } from './math-wrap';
import type { TextMathOptions } from './math-wrap';
import { formatDisplayMath } from './latex';
import { fixSpacing } from './spacing';
import type { SpacingOptions } from './spacing';
import { formatTags } from './tags';
import type { TagLayoutOptions } from './tags';
import { sortContentBlocks } from './block-sort';

export interface TextPipelineOptions {
	/** 行首缩进修复力度；`off` 时连标记排版一起停用 */
	leadingIndent: LeadingIndentMode;
	/** 聊天记录排版选项 */
	chat: ChatLogOptions;
	/** 是否整理列表序号（保证每个列表的首项编号是 1） */
	listRenumber: boolean;
	/** 是否整理标题级别（子标题与父标题恰好差一级） */
	headingLevels: boolean;
	/** 智能公式：把正文里的数学符号包成 `$…$` */
	textMath: TextMathOptions;
	/** 是否整理 `$$…$$` 公式排版（代码格式） */
	mathLayout: boolean;
	/** 空格排版选项（排版格式）：中文 / 英文 / 数字 / 公式 / 标点之间的距离 */
	spacing: SpacingOptions;
	/** 标签排版选项；关闭时传 null */
	tags: TagLayoutOptions | null;
	/** 是否按首字母给内容块排序 */
	blockSort: boolean;
}

/** 按固定顺序跑一遍所有步骤（不做迭代，见 formatNoteText） */
function runPipelineOnce(raw: string, options: TextPipelineOptions): string {
	let content = fixLeadingIndent(raw, options.leadingIndent);
	// 「行首缩进修复」关掉时整块文本排版都停用，用户拿它当总开关
	if (options.leadingIndent !== 'off') content = fixBlockMarkers(content);
	content = formatChatLog(content, options.chat);
	if (options.listRenumber) content = fixListNumbers(content);
	if (options.headingLevels) content = fixHeadingLevels(content);
	content = wrapPlainMath(content, options.textMath);
	if (options.mathLayout) content = formatDisplayMath(content);
	content = fixSpacing(content, options.spacing);
	if (options.tags) content = formatTags(content, options.tags);
	if (options.blockSort) content = sortContentBlocks(content);

	return content;
}

/**
 * 整条流水线的最多轮数（跑一遍不再变化就提前停）。
 *
 * 每一轮最多新增一批 `$…$`，而"能包的位置"是有限的，所以轮数有限；实测 1–3 轮。
 */
const MAX_PIPELINE_ROUNDS = 5;

/**
 * 修复一篇笔记的排版。
 *
 * ## 为什么要跑不止一遍
 *
 * 每个步骤自己是幂等的（同一份输入跑两次结果一样），但**后面的步骤会改前面的步骤看过的文本**，
 * 于是"跑一遍"与"跑两遍"结果不同 —— 那样用户每次保存都会被再改一次。实测到的两条：
 *
 * - 「数字 ↔ 单位」会给 `5/10mm` 补上那一格变成 `5/10 mm`（空格排版，第 6 步），
 *   而智能公式（第 4 步）要看到 `5/10 mm` 才认得出这是算式 —— 下一轮才包成 `$5/10 mm$`；
 * - 公式排版把 `$w\\approx 0$` 规范成 `$w \approx 0$`（第 5 步）会改变**板块排序的键**
 *   （键就是块首那一行，第 8 步），于是排序结果又变一次。
 *
 * 所以整条流水线一起迭代到不动点：一次命令 = 一直跑到不再变化。
 *
 * 注：智能公式现在要求**二元运算符两侧各留一格**（紧贴的一律不认，`5/10mm` 这类不再包公式），
 * 上面第一条"补格子 → 认出算式"的链路已不再发生；迭代保留为跨步骤的安全网 ——
 * 各开关组合下的收敛与幂等由 test/text-pipeline.test.ts 逐条守着。
 *
 * @param raw 笔记原文
 * @param options 各步骤的选项（由插件设置转换而来）
 * @returns 排版后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function formatNoteText(raw: string, options: TextPipelineOptions): string {
	if (raw === '') return raw;

	let content = raw;
	for (let round = 0; round < MAX_PIPELINE_ROUNDS; round++) {
		const next = runPipelineOnce(content, options);
		if (next === content) break;
		content = next;
	}

	return content;
}
