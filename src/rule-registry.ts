/**
 * 规则登记表：**一条规则一条记录**，把「规范出处 ↔ 设置开关 ↔ 实现 ↔ 测试」串起来。
 *
 * ## 为什么要有这张表
 *
 * 排版规则是在笔记规范（vault 里的 `data/data note/note note.md`）里讨论出来的，
 * 代码这边靠注释里的"英文符号 1""标记命名 4"来标出处。讨论久了必然出事：
 * 规范改过一轮之后（`latex 符号格式` 这一节被并进 `通用符号` 并重新编号），
 * 注释里的出处就对不上了 —— 没人知道哪条实现对应哪条规则，也没人知道改规范要动哪里。
 *
 * 这张表把三件事固定下来，并由 test/rules.test.ts 逐条核对：
 * 1. **规范出处真的存在**（章节路径 + 条目号能在规范笔记里找到；找不到规范文件时自动跳过，CI 不受影响）；
 * 2. **开关真的存在**（`switchKeys` 里的每一项都必须是设置字段，且设置面板里有对应的项；反过来每个设置字段也都要有规则用着）；
 * 3. **实现与测试真的存在**（`impl.file` 里的符号、`tests` 里的文件都必须能找到）。
 *
 * 这样"规范改了、代码没跟上"会变成一条测试失败，而不是半年后的一次考古。
 *
 * ## 状态说明
 *
 * - `done`：有实现，行为与规范一致；
 * - `partial`：实现了，但有已知偏差（`note` 里写明差在哪）；
 * - `spec-only`：规范里有这一条，代码里没有对应实现（`note` 里写明现状）。
 *
 * `docs/规则登记表.md` 由本文件生成（`node test/run-tests.mjs --update-rules-doc`）。
 */

/** 规范出处：规范笔记里的章节路径 + 条目号 */
export interface SpecRef {
	/** 章节路径，用 ` / ` 连接各级标题，如 `格式 / 排版格式 / 标点符号 / 通用符号` */
	path: string;
	/** 该节里第几条（规范用 `1.` `2.` 编号，只认顶格的那些） */
	item: number;
}

/** 实现状态 */
export type RuleStatus = 'done' | 'partial' | 'spec-only';

export interface RuleRecord {
	/** 稳定标识 */
	id: string;
	/** 一句话说明这条规则做什么 */
	name: string;
	/** 规范出处；规范里没有对应条目时为 null */
	spec: SpecRef | null;
	status: RuleStatus;
	/** 这条规则牵动的设置开关（设置字段名）；没有开关时是空数组 */
	switchKeys: string[];
	/** 实现位置：文件 + 其中的声明名（导出与否都行） */
	impl: { file: string; symbols: string[] };
	/** 覆盖这条规则的测试文件 */
	tests: string[];
	/** 备注：已知偏差、重复实现、规范缺口…（status 不是 done 时必填） */
	note?: string;
}

export interface RuleSection {
	heading: string;
	rules: RuleRecord[];
}

/** 规范笔记的默认位置（相对仓库根）与环境变量覆盖 */
export const SPEC_NOTE_PATH = process.env.NOTE_TIDY_SPEC ?? '../../../data/data note/note note.md';

/**
 * 规范里的章节路径。
 *
 * 2026-09 规范重排过一次：`## 排版格式` 这一层被取消（各节直接挂在 `# 格式` 下）、
 * `标签` / `数字` 改名成 `标签格式` / `数字格式`、`## latex 排版格式` 并进了
 * `### 公式代码格式`、代码格式那一节重编了号。这份路径跟着规范走 ——
 * 规范再改，test/rules.test.ts 会立刻报"找不到这一节"。
 */
const S = {
	general: '格式 / 概论',
	code: '格式 / 代码格式',
	formulaCode: '格式 / 代码格式 / 公式代码格式',
	tag: '格式 / 标签格式',
	digit: '格式 / 数字格式',
	punctGeneral: '格式 / 标点符号 / 概论',
	commonSymbol: '格式 / 标点符号 / 通用符号',
	cnSymbol: '格式 / 标点符号 / 中文符号',
	enSymbol: '格式 / 标点符号 / 英文符号',
	mathSymbol: '格式 / 标点符号 / 数学符号',
	textGeneral: '格式 / 文字格式 / 概论',
	textEnglish: '格式 / 文字格式 / 英文',
	marker: '命名 / 标记命名',
} as const;

export const RULE_SECTIONS: RuleSection[] = [
	{
		heading: '图片功能',
		rules: [
			{
				id: 'image.transfer',
				name: '外部绝对路径图片导入仓库，链接换成内部双链',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder'],
				impl: { file: 'src/image/transfer.ts', symbols: ['transferExternalImages'] },
				tests: [],
				note: '依赖 Obsidian 的 vault / fileManager API，没有单测；附件夹定位另有 image.attachment-folder 一条',
			},
			{
				id: 'image.attachment-folder',
				name: '附件文件夹定位与按需创建',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder'],
				impl: {
					file: 'src/image/attachment-folder.ts',
					symbols: ['resolveAttachmentFolder', 'getTargetAttachmentFolder', 'ensureFolder', 'parentPathOf'],
				},
				tests: [],
				note: '「只算路径」与「真的要写才创建」分成两步，避免给没有图片的笔记凭空建空文件夹',
			},
			{
				id: 'image.garbled',
				name: '乱码图片改名（特殊字符 / URL 编码残留 / 纯数字点号）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/image/rename.ts', symbols: ['isGarbledImageName', 'renameGarbledImages'] },
				tests: [],
				note: '三条判据见 isGarbledImageName 的注释；改名走 Obsidian 原生 renameFile，所以没有纯函数单测',
			},
			{
				id: 'image.rename-preset',
				name: '按预设改名（含强制模式与「已符合格式就保留原名」）',
				spec: null,
				status: 'done',
				switchKeys: ['imageNamePreset'],
				impl: {
					file: 'src/image/rename.ts',
					symbols: ['renameImagesToPreset', 'countImages'],
				},
				tests: [],
				note: '预设 → 正则的转换在 image/naming.ts 的 matchesNamePreset',
			},
			{
				id: 'image.unique-name',
				name: '文件名在仓库里唯一（四层检查，重名往后推一秒）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/naming.ts',
					symbols: ['generateUniqueTargetPath', 'buildVaultBasenameMap'],
				},
				tests: [],
				note: '裸文件名链接一旦撞名，笔记可能显示成另一张图，所以这条是图片功能的硬约束',
			},
			{
				id: 'image.same-name',
				name: '同名图片歧义时不猜（宁可跳过，也不改错文件）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/links.ts',
					symbols: ['resolveImageLink', 'buildBasenameIndex', 'linkBasename'],
				},
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.link-format',
				name: '链接写法：完整路径还是仅文件名（同名时强制完整路径）',
				spec: null,
				status: 'done',
				switchKeys: ['renameLinkFormat'],
				impl: {
					file: 'src/image/links.ts',
					symbols: ['chooseLinkTarget', 'isImagePath', 'buildCopyName'],
				},
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.link-normalize',
				name: '改名后统一修正全库链接格式（保留 `#片段`）',
				spec: null,
				status: 'done',
				switchKeys: ['renameLinkFormat'],
				impl: { file: 'src/image/rename.ts', symbols: ['fixImageLinkFormats'] },
				tests: [],
			},
			{
				id: 'image.organize',
				name: '整理图片位置：把别处的图片复制进本笔记的附件夹',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder', 'renameLinkFormat'],
				impl: { file: 'src/image/organize.ts', symbols: ['organizeNoteImages'] },
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.size',
				name: '图片大小批改（宽 / 高 / 是否覆盖已有尺寸）',
				spec: null,
				status: 'done',
				switchKeys: ['imageSizeWidth', 'imageSizeHeight', 'imageSizeOverwrite'],
				impl: {
					file: 'src/image/size.ts',
					symbols: ['applyImageSize', 'validateImageSize', 'toSizeString'],
				},
				tests: ['test/image-size.test.ts'],
			},
			{
				id: 'image.external-path',
				name: '弹性路径解析：URL 编码、Markdown 转义、大小写不一致都能找到文件',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/external-path.ts',
					symbols: ['flexibleProbing', 'resolvePhysicalPath'],
				},
				tests: [],
				note: '直接读磁盘，测试需要真实文件系统，故只有手动验证',
			},
			{
				id: 'image.extension-sets',
				name: '两套扩展名表：受管位图（会改名）与图片链接判定（更宽）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/constants.ts',
					symbols: ['MANAGED_IMAGE_EXTENSIONS', 'MANAGED_IMAGE_EXT_RE', 'wikiEmbedRe', 'externalImageRe'],
				},
				tests: [],
				note: '刻意不合并：合并会让改名功能开始碰 .svg，或让 avif 链接解析不出来（见文件头注释）',
			},
		],
	},
	{
		heading: '排版格式 · 标点与符号',
		rules: [
			{
				id: 'punct.half-width',
				name: '半角标点 `, . ! ? :` 前不留空格、后空一格',
				spec: { path: S.enSymbol, item: 1 },
				status: 'done',
				switchKeys: ['spacingHalfPunct'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.quote',
				name: '包裹符号：引号自己不添空格（内侧贴紧，外侧按「分隔语言」办）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['OPEN_QUOTE_RULE', 'CLOSE_QUOTE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '与 punct.bracket 同一条语义：**包裹符号自己不添空格** —— 内侧贴紧（`" 引文 "` → `"引文"`、`" + "` → `"+"`），外侧不主动加也不删语言自带的词距（中文旁贴紧 `他说 "你好" 了` → `他说"你好"了`；西文旁留一格 `He said "hello" loudly`，那是英文词距）。落单的引号（`2" 的管子`）不成对，一个字符都不动',
			},
			{
				id: 'punct.ellipsis',
				name: '`...` 前后不留空格',
				spec: { path: S.enSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/tokenize.ts', symbols: ['markEllipsisRuns'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.en-modifier',
				name: '英文里修饰符号与所修饰的词看作整体（`he is the "man"` 周围保留词距）',
				spec: { path: S.enSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['OPEN_QUOTE_RULE', 'CLOSE_QUOTE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '实现机制是 SymbolRule.scope = latin：修饰符号的 `space` 只对**西文内容**生效 —— 所以英文旁按词距留一格（`he is the "man"` 原样；漏了就补，`the"man"` → `the "man"`），中文旁贴紧（`他说 "你好" 了` → `他说"你好"了`）。中文侧写的是「内外均没有空格」（通用符号 3 的包裹符号子条目），英文侧写的是这条 —— 两句话说的是同一件事的两面',
			},
			{
				id: 'punct.bracket',
				name: '包裹符号：括号自己不添空格（内侧贴紧，外侧按「分隔语言」办）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingBracketInner'],
				impl: {
					file: 'src/text/spacing/gap.ts',
					symbols: ['decideGap'],
				},
				tests: ['test/spacing.test.ts'],
				note: '「内外均没有空格」的意思是**包裹符号自己不添空格**，不是"把外侧已有的空格也删掉"：内侧的填充空格删掉（`( x )` → `(x)`），外侧不主动加、也不删**语言自带**的词距 —— 西文旁那一格是英文词距（`appendix (page 3)`），中文旁本来就没有（`中文 (说明)` → `中文(说明)`、`he said 你好(nihao)`）。`||` 这种包裹符号另见 punct.package',
			},
			{
				id: 'punct.package',
				name: '包裹符号 `||` 前后不加空格（`范数 ||x||` 的外侧留白不删）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['PACKAGE_RULE'] },
				tests: ['test/spacing.test.ts'],
				note: '连续两个及以上的 `|` 整体当包裹符号，按 通用符号 3 的包裹符号子条目贴紧；外侧给 `keep`：紧贴内容那一侧本来就贴着，而"范数 ||x|| 的写法"这种外侧留白属于文字间距规则，包裹符号不该去删它',
			},
			{
				id: 'punct.full-width',
				name: '全角标点两侧不留空格（引号与书名号内部除外）',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingFullPunct'],
				impl: { file: 'src/text/spacing/tokenize.ts', symbols: ['classifyChar'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.language-switch',
				name: '标点全半角按语境切换（中文句用全角、英文句用半角）',
				spec: { path: S.punctGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingHalfToFullPunct'],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['convertHalfPunct', 'convertFullPunct', 'sentenceLanguages'],
				},
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.symbol-adjacent',
				name: '符号与符号之间没有空格（`,：`、`(+)`、`"+"`）',
				spec: { path: S.punctGeneral, item: 4 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'symbol.cjk-adjacent',
				name: '中文与符号之间不加空格（`瑞克&莫蒂`）',
				spec: { path: S.cnSymbol, item: 1 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
				note: '实现方式是 SymbolRule.scope = latin：`space` 只对西文内容生效，中文旁与符号旁一律贴紧',
			},
			{
				id: 'symbol.ampersand',
				name: '`&` 与前后内容之间留一格（正文里只与西文内容留）',
				spec: { path: S.commonSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'symbol.dollar-inside',
				name: '`$` 内侧永远不空（Obsidian 能否认出公式的前提）',
				spec: { path: S.commonSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingMathText'],
				impl: {
					file: 'src/text/inline-scan.ts',
					symbols: ['readInlineMath'],
				},
				tests: ['test/spacing.test.ts', 'test/latex-layout.test.ts'],
				note: '识别规则只有一份（inline-scan 的 readInlineMath），公式排版 latex.ts 判断行内公式收尾也用它 —— 2026-09 收敛后不再各写一份',
			},
			{
				id: 'symbol.modifier',
				name: '修饰符号不加空格（`^`、单独一个 `|`）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['SYMBOL_RULES', 'STANDALONE_PIPE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '包裹符号（`()`、`||`、引号）归在「通用符号 3」的包裹符号子条目下，见 punct.bracket、punct.quote 与 punct.package',
			},
			{
				id: 'symbol.relation',
				name: '运算 / 关系符号与前后内容之间加空格（`→`）',
				spec: { path: S.commonSymbol, item: 4 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['RELATION_COMMANDS', 'RELATION_CHARS', 'separator'],
				},
				tests: ['test/spacing.test.ts', 'test/latex-layout.test.ts'],
			},
			{
				id: 'symbol.spacing-command',
				name: '空格符号看作空格，与前后相连（`x\\, dr`）',
				spec: { path: S.commonSymbol, item: 5 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['SPACING_COMMANDS', 'SINGLE_SPACING_COMMANDS', 'isSpacingOnly', 'splitGluedSpacing'],
				},
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'symbol.no-rule',
				name: '符号表里没有的符号一律不动（`~`、`-` 连字符）',
				spec: { path: S.commonSymbol, item: 6 },
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
				note: '规范第 6、7 条要求 `~`、`-` 两边不加空格，实现方式是**故意不进符号表**（见 symbols.ts 表后的说明）：既不添空格，也不删作者写的空格 —— `甲 ~ 乙` 与 `甲~乙` 都原样保留（`约 ~5 个` 里少掉的那一格来自"中文 ↔ 数字"规则，与 `~` 无关）。排版不替作者补他没写的东西，也不删他写的东西',
			},
		],
	},
	{
		heading: '排版格式 · 文字与数字',
		rules: [
			{
				id: 'text.cjk-latin',
				name: '中文 ↔ 英文之间空一个字宽',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingCjkLatin'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
				note: '行内代码、双链、链接、标签与英文等价（标记命名 10）',
			},
			{
				id: 'text.cjk-digit',
				name: '中文 ↔ 数字之间不留空格（`第 3 章` → `第3章`）',
				spec: { path: S.digit, item: 2 },
				status: 'done',
				switchKeys: ['spacingCjkDigit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.latin-digit',
				name: '英文 ↔ 数字之间：默认保持原样（专有名词优先）',
				spec: { path: S.digit, item: 3 },
				status: 'done',
				switchKeys: ['spacingLatinDigit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.math-gap',
				name: '行内公式 ↔ 文字之间空一格（只动 `$` 外面）',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingMathText'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.digit-unit',
				name: '数字 ↔ 单位之间空一格（单位须在词表里）',
				spec: { path: S.mathSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingDigitUnit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['UNITS', 'decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.proper-noun',
				name: '专有名词的空格以原有形式为准（《新 吊带袜天使》）',
				spec: { path: S.textGeneral, item: 4 },
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['markTitlePieces'],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts'],
				note: '中文与中文之间的空格不动；书名号与引号内部的字符一个都不动（math-wrap.ts 的 protectTitles 同理）',
			},
			{
				id: 'text.english-word',
				name: '带其他符号的英文词按单词整体处理（`GPT4`、`v1.2.2`）',
				spec: { path: S.textEnglish, item: 1 },
				status: 'done',
				switchKeys: ['spacingCjkLatin'],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['markAlphanumericWords', 'markAbbreviationPieces'],
				},
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.use-space-sparingly',
				name: '不要滥用空格：空格只用来分隔不同语言的内容',
				spec: { path: S.punctGeneral, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
		],
	},
	{
		heading: '排版格式 · 结构与顺序',
		rules: [
			{
				id: 'structure.tag-placement',
				name: '标签归位：写到内容最后，与正文空一格',
				spec: { path: S.tag, item: 1 },
				status: 'done',
				switchKeys: ['tagLayout'],
				impl: { file: 'src/text/tags.ts', symbols: ['formatTags', 'layoutBlock', 'stripTags'] },
				tests: ['test/tags.test.ts'],
			},
			{
				id: 'structure.tag-sort',
				name: '同一处的多个标签按首字母排序',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: ['tagSort'],
				impl: { file: 'src/text/tags.ts', symbols: ['orderTags'] },
				tests: ['test/tags.test.ts'],
			},
			{
				id: 'structure.block-sort',
				name: '内容板块按首字母排序（只在同类相邻块之间）',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: ['blockSort'],
				impl: { file: 'src/text/block-sort.ts', symbols: ['sortContentBlocks'] },
				tests: ['test/block-sort.test.ts'],
			},
			{
				id: 'structure.collate',
				name: '首字母比较：中文按拼音、数字按数值、大小写与全半角不敏感',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/collate.ts', symbols: ['compareByFirstLetter'] },
				tests: ['test/tags.test.ts', 'test/block-sort.test.ts'],
			},
			{
				id: 'structure.indent',
				name: '行首缩进归一：4 个空格算一个 tab，零散空格删掉',
				spec: { path: S.commonSymbol, item: 1 },
				status: 'done',
				switchKeys: ['textLeadingIndentFix'],
				impl: { file: 'src/text/indent.ts', symbols: ['fixLeadingIndent', 'resolveLeadingIndentMode'] },
				tests: ['test/text-layout.test.ts'],
				note: '规范「通用符号 1」只定了 tab 的宽度（一个 tab 4 个字宽），"哪些空格删、列表子项保留、标记空白"是实现约定（另见 structure.markers）。`off` 同时是整块文本排版的总开关',
			},
			{
				id: 'structure.markers',
				name: '块级标记空白：引用 `>` 后补空格、列表与标题符号后的多个空格收成一个',
				spec: { path: S.marker, item: 15 },
				status: 'done',
				switchKeys: ['textLeadingIndentFix'],
				impl: { file: 'src/text/markers.ts', symbols: ['fixBlockMarkers'] },
				tests: ['test/markdown-markers.test.ts'],
			},
			{
				id: 'structure.list-number',
				name: '列表序号整理：保证每个列表的首项编号是 1',
				spec: null,
				status: 'done',
				switchKeys: ['listRenumber'],
				impl: { file: 'src/text/list-numbering.ts', symbols: ['fixListNumbers'] },
				tests: ['test/list-numbering.test.ts'],
				note: '规范里没有"序号从 1 开始"这一条；相关的是 数字格式 第 1 条（需要用几位数字就占几位）—— 实现照此不加前导零。首项已经是 1 的列表一律不动（`1. 1. 1.`、`1. 5. 9.` 都是作者故意写的形态，block-sort.ts 的编号整理也保留这两种）',
			},
			{
				id: 'structure.heading-level',
				name: '标题级别整理：子标题与父标题恰好差一级',
				spec: null,
				status: 'done',
				switchKeys: ['headingLevelFix'],
				impl: { file: 'src/text/heading-levels.ts', symbols: ['fixHeadingLevels'] },
				tests: ['test/heading-levels.test.ts'],
				note: '规范里没有"父子标题差一级"这一条；相关的是 模板 / 内容模板应用 / 标题分级 第 1 条（引用其他笔记的标题内容时要额外写一个相同的标题防止分级错误）—— 所以首个标题的级别保持原样，只压缩父子之间的跳级。新级别全部从原始级别一次算出，多个标题同时改时不会互相串',
			},
			{
				id: 'structure.chat-log',
				name: '聊天记录排版：头部信息与正文缩进、图文顺序、消息间空行',
				spec: null,
				status: 'done',
				switchKeys: [
					'chatShowUsername', 'chatShowDate', 'chatShowTime',
					'chatIndent', 'chatImageOrder', 'chatBlankLineBetweenMessages',
				],
				impl: { file: 'src/text/chat-log.ts', symbols: ['formatChatLog', 'resolveIndent'] },
				tests: ['test/chat-log.test.ts'],
				note: '规范里没有对应条目；必须严格幂等（重复执行不能再产生空行或空格变化）',
			},
		],
	},
	{
		heading: '代码格式 · 公式',
		rules: [
			{
				id: 'math.latex-only',
				name: '公式和符号都用 latex 语法打（正文数学符号自动包 `$…$`）',
				spec: { path: S.code, item: 4 },
				status: 'done',
				switchKeys: ['textMathWrapSymbols'],
				impl: {
					file: 'src/text/math-wrap.ts',
					symbols: ['wrapPlainMath', 'mathStretches', 'isMathLike', 'isMathContext', 'renderStretch'],
				},
				tests: ['test/text-math.test.ts'],
				note: '规范只写了"用 latex 语法打"；判定规则（数学语境词、量词、变量表、专有名词与缩写排除）是实现补充，见模块头注释',
			},
			{
				id: 'math.space-equals-render',
				name: '代码里的空格 = 公式渲染出来的空格（只在 `\\\\` 处换行）',
				spec: { path: S.code, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['tokenize', 'separator', 'renderTokens'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.brace',
				name: '拼接会吃掉命令名时补花括号（`\\delta x` → `\\delta{x}`）',
				spec: { path: S.code, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['needsBrace'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.indent',
				name: '公式代码不额外缩进；续行缩进 = 首行缩进 + 1 个 tab',
				spec: { path: S.formulaCode, item: 1 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['leadingWhitespace', 'formatDisplayBlocks'],
				},
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.big-operator',
				name: '大型运算符（`\\begin{}` / `\\end{}`）连环境名当一个整体，前后不加空格',
				spec: { path: S.formulaCode, item: 2 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['tokenize', 'separator'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.unary',
				name: '正负号等修饰符号前后没有空格（一元 / 二元按上下文判断）',
				spec: { path: S.mathSymbol, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['isUnary', 'SIGN_CHARS'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.relation-gap',
				name: '公式里运算符号 / 关系符号前后加空格，列举逗号后加空格',
				spec: { path: S.mathSymbol, item: 1 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['separator', 'RELATION_COMMANDS'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.math-mode-text',
				name: '公式里裸写的中文包进 `\\text{…}`',
				spec: { path: S.code, item: 4 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['wrapMathText', 'FULL_WIDTH_RE'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.derivative-space',
				name: '微分算子前加薄空格（`f(x)\\, dr`）',
				spec: { path: S.mathSymbol, item: 5 },
				status: 'spec-only',
				switchKeys: [],
				impl: { file: 'src/text/latex.ts', symbols: ['SINGLE_SPACING_COMMANDS'] },
				tests: ['test/latex-layout.test.ts'],
				note: '代码只保留作者自己写好的 `\\,`（当普通间距命令处理），**不自动补**：微分算子是写法问题，排版不该替作者补他没写的内容（2026-09 明确决定，别再"补全"）',
			},
		],
	},
	{
		heading: '横切机制',
		rules: [
			{
				id: 'cross.protect-lines',
				name: '整行保护区：frontmatter、围栏 / 缩进代码块、GFM 表格',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/line-scan.ts',
					symbols: ['markProtectedLines', 'markIndentedCodeLines', 'markTableLines', 'inlineCodeRanges'],
				},
				tests: ['test/spacing.test.ts', 'test/tags.test.ts', 'test/block-sort.test.ts'],
				note: '规范里没写，但改坏代码块是排版类功能最大的风险',
			},
			{
				id: 'cross.protect-inline',
				name: '行内保护区：行内代码、双链与链接、URL、HTML、注释、标签',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/inline-scan.ts', symbols: ['collectMaskedRanges', 'isSpaceChar'] },
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts'],
			},
			{
				id: 'cross.math-recognition',
				name: '`$$…$$` 区块与行内 `$…$` 的识别与配对',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/inline-scan.ts',
					symbols: ['readInlineMath', 'dollarPositions', 'dollarMarks', 'mathRanges', 'mathOpaqueLines'],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts', 'test/tags.test.ts'],
				note: '识别与配对**只有这一份实现**（2026-09 收敛）：行内 `$…$` 用 readInlineMath、`$$` 位置用 dollarPositions、按行配对用 mathRanges，行级消费者（标签排版、板块排序）问"这行能不能碰"就用 mathOpaqueLines。以前散着 6 份（还有 line-scan.markMathLines 与 latex.ts 的 collectMarks / findInlineMathEnd），其中两套配对算法对"一行内成对 `$$…$$`"给出不同答案 —— 标签排版当整行保护区、空格排版当整行可排版，于是含公式行上的标签不归位。现在两种问法同源：跨行区块的行与起止行整行跳过，一行内成对的行照常排版',
			},
			{
				id: 'cross.pipeline',
				name: '流水线顺序与不动点迭代：每步幂等，只在真正变化时写盘',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/pipeline.ts', symbols: ['formatNoteText'] },
				tests: ['test/text-pipeline.test.ts'],
				note: '顺序理由写在 pipeline.ts 头部；整条链迭代到不动点（最多 5 轮），因为后面的步骤会改前面的步骤看过的文本',
			},
			{
				id: 'cross.batch',
				name: '批量外壳：互斥锁 + 通知屏蔽 + 状态栏进度，单篇失败不拖垮整批',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/batch.ts', symbols: ['BatchRunner'] },
				tests: ['test/commands.test.ts'],
			},
		],
	},
];

/** 平面化：所有规则（测试与文档都按这个顺序） */
export const ALL_RULES: RuleRecord[] = RULE_SECTIONS.flatMap(section => section.rules);

/** 生成 `docs/规则登记表.md` 的内容（纯函数，测试与生成器共用一份） */
export function renderRuleRegistryDoc(): string {
	const lines: string[] = [
		'# 规则登记表',
		'',
		'> 本文件由 `src/rule-registry.ts` 生成，**请勿手改**。',
		'>',
		'> 重新生成：`node test/run-tests.mjs --update-rules-doc`（`npm test` 会核对它与表是否一致）。',
		'>',
		'> 规范出处指 vault 里的 `data/data note/note note.md`；改规范或改实现时，先改 `src/rule-registry.ts`，再重新生成这份文档。',
		'',
		'状态：`done` 有实现且与规范一致 · `partial` 实现了但有已知偏差 · `spec-only` 规范里有、代码里没有。',
		'',
	];

	for (const section of RULE_SECTIONS) {
		lines.push(`## ${section.heading}`, '');
		lines.push('| ID | 规则 | 规范出处 | 状态 | 开关 | 实现 | 测试 |');
		lines.push('| --- | --- | --- | --- | --- | --- | --- |');
		for (const rule of section.rules) {
			const spec = rule.spec ? `${rule.spec.path} · 第 ${rule.spec.item} 条` : '—';
			const impl = `\`${rule.impl.file}\`<br>${rule.impl.symbols.map(symbol => `\`${symbol}\``).join(' ')}`;
			const tests = rule.tests.length > 0 ? rule.tests.map(test => `\`${test}\``).join('<br>') : '—';
			lines.push(`| \`${rule.id}\` | ${rule.name} | ${spec} | ${rule.status} | ${rule.switchKeys.length > 0 ? rule.switchKeys.map(key => `\`${key}\``).join(' ') : '—'} | ${impl} | ${tests} |`);
		}
		lines.push('');

		const noted = section.rules.filter(rule => rule.note);
		if (noted.length > 0) {
			lines.push('备注：', '');
			for (const rule of noted) {
				lines.push(`- \`${rule.id}\`：${rule.note}`);
			}
			lines.push('');
		}
	}

	return lines.join('\n');
}
