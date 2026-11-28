import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from '../../text/spacing';
import { resolveLeadingIndentMode } from '../../text/indent';
import type { FieldSection } from './types';

/**
 * 「文本排版」一页：排版流水线每一步的开关与选项。
 *
 * 分组顺序与流水线一致（见 `text/pipeline.ts` 文件头）：
 * 行首与标记 → 聊天记录 → Bangumi 讨论 → 公式 → 空格 → 标签与内容块。
 * 这样某一处排版不符合预期时，可以按页面顺序找到对应的步骤。
 *
 * 每一节的说明文字以笔记中的《排版格式》规范为准。
 * 修改规则时先改规范，再改这里的文案，最后改对应模块的实现（见 rule-registry.ts）。
 */

export const TEXT_SECTION: FieldSection = {
	type: 'page',
	heading: '文本排版',
	desc: '笔记的缩进、标题、聊天记录、公式与空格。',
	groups: [
		{
			heading: '行首与标记',
			fields: [
				{
					key: 'textLeadingIndentFix',
					name: '行首缩进修复',
					desc: '修复行首缩进，以及列表、引用标记前的空格。',
					control: {
						type: 'dropdown',
						options: {
							smart: '智能：保留列表子项，删除其余行首空格（推荐）',
							strict: '严格：行首只保留制表符',
							off: '关闭',
						},
					},
					coerce: (value) => resolveLeadingIndentMode(value),
				},
				{
					key: 'listRenumber',
					name: '整理列表序号',
					desc: '列表首项从 1 开始编号。',
					control: { type: 'toggle' },
				},
				{
					key: 'headingLevelFix',
					name: '整理标题级别',
					desc: '子标题与父标题相差一级。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '聊天记录格式',
			fields: [
				{
					key: 'chatShowUsername',
					name: '显示用户名',
					desc: '开启后，完整格式包含该字段；Ctrl+V 粘贴的纯内容不含。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatShowDate',
					name: '显示日期',
					desc: '开启后，完整格式包含该字段；Ctrl+V 粘贴的纯内容不含。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatShowTime',
					name: '显示时间',
					desc: '开启后，完整格式包含该字段；Ctrl+V 粘贴的纯内容不含。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatMergeSameUser',
					name: '同一用户连续消息合并',
					desc: '同一用户连续发送多条消息时合并为一条，只保留第一条的用户名与时间。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatBlankLineBetweenMessages',
					name: '消息之间插入空行',
					desc: '在相邻消息之间插入一个空行；纯内容不插入空行。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatImageOrder',
					name: '图文消息中图片的位置',
					desc: '控制完整格式中图片相对文字的位置；纯内容保持原顺序。',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原顺序',
							above: '图片在文字上方',
							below: '图片在文字下方',
						},
					},
				},
			],
		},
		{
			heading: '提取为纯内容的格式',
			fields: [
				{
					key: 'chatIndent',
					name: '正文缩进',
					desc: 'Ctrl+V 与右键「粘贴为聊天记录」共用。',
					control: {
						type: 'dropdown',
						options: {
							tab: '制表符',
							'2': '2 个空格',
							'4': '4 个空格',
							none: '不缩进',
						},
					},
				},
				{
					key: 'chatSortByTime',
					name: '相邻消息按时间排序',
					desc: '仅调整相邻消息的顺序，不改变内容。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatStripMentions',
					name: '去掉 @ 提及',
					desc: '删除消息正文中的 @昵称。默认关闭。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: 'Bangumi 讨论',
			fields: [
				{
					key: 'bangumiShowFloor',
					name: '显示楼层号',
					desc: '在用户名后显示序号。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiShowTime',
					name: '显示楼层时间',
					desc: '在用户名后显示时间。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiShowSignature',
					name: '保留签名',
					desc: '保留用户名后的签名。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiStripReactions',
					name: '去掉贴贴与页面控件',
					desc: '删除贴贴计数与页面控件，正文保持不变。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiStripSmiles',
					name: '去掉表情',
					desc: '删除表情文字（如 (bgm38)）。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiLinkUsers',
					name: '用户名带主页链接',
					desc: '网页导入时为用户名添加主页链接。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiImageMode',
					name: '网页导入时的图片',
					desc: '选择保留远程链接或导入到仓库。',
					control: {
						type: 'dropdown',
						options: {
							link: '保留远程链接（默认）',
							import: '导入到仓库（静态图片；GIF 与视频保留链接）',
						},
					},
				},
				{
					key: 'bangumiTitleMode',
					name: '网页导入时的标题',
					desc: '选择丢弃标题、插为二级标题，或重命名当前文件。',
					control: {
						type: 'dropdown',
						options: {
							none: '不处理（默认）',
							heading: '插为二级标题',
							rename: '重命名当前文件',
						},
					},
				},
				{
					key: 'bangumiBlankLineWithinPost',
					name: '楼层内部段落间留空行',
					desc: '在同一条回复的段落之间留空行。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiBlankLineBetweenPosts',
					name: '不同楼层之间留空行',
					desc: '开启后，在两段内容之间插入一个空行。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '公式',
			fields: [
				{
					key: 'textMathWrapSymbols',
					name: '数学符号自动转为公式',
					desc: '把正文中的数学符号写成 $…$ 公式。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'mathLayout',
					name: '公式排版',
					desc: '整理 $$…$$ 中 LaTeX 代码的空格与换行。默认关闭。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '文字间距',
			fields: [
				{
					key: 'spacingCjkLatin',
					name: '中文与英文之间',
					desc: '写成「中文 English」。默认开启。',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽（推荐）',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.cjkLatin),
				},
				{
					key: 'spacingCjkDigit',
					name: '中文与数字之间',
					desc: '选择不留空格、空一个字宽或保持原样。默认不留空格。',
					control: {
						type: 'dropdown',
						options: {
							none: '不留空格（按笔记规则，推荐）',
							space: '空一个字宽',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveCjkDigitMode(value),
				},
				{
					key: 'spacingLatinDigit',
					name: '英文与数字之间',
					desc: '选择保持原样或空一个字宽。默认保持原样。',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原样（推荐）',
							space: '空一个字宽',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.latinDigit),
				},
				{
					key: 'spacingMathText',
					name: '公式与文字之间',
					desc: '写成「文字 $x$ 文字」。默认开启。',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽（推荐）',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.mathText),
				},
				{
					key: 'spacingChapterTitle',
					name: '标题标记与标题内容之间',
					desc: '写成「## 标题」。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标点与符号',
			fields: [
				{
					key: 'spacingFullPunct',
					name: '全角标点前后不留空格',
					desc: '删除该标点前后的空格。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfPunct',
					name: '半角标点前不留空格、后空一格',
					desc: '对半角标点 , . ! ? : 生效。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingBracketInner',
					name: '括号内侧不留空格',
					desc: '写成「中文（说明）」与「f(x)」。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingDigitUnit',
					name: '数字与单位之间空一格',
					desc: '写成「10 km」。单位需在内置单位表中。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfToFullPunct',
					name: '标点全半角按语境',
					desc: '中文句子使用全角标点，英文与公式使用半角标点。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingSymbolPad',
					name: '符号间距规则',
					desc: '按符号分别处理空格，如逗号后空一格、竖线前后空一格。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标签与内容块',
			fields: [
				{
					key: 'tagLayout',
					name: '标签排版',
					desc: '把行内标签移到所在内容块的末尾。默认关闭。',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'tagSort',
					name: '标签排序',
					desc: '同一处出现的多个标签按首字母排序。',
					control: { type: 'toggle' },
					disabled: (settings) => !settings.tagLayout,
				},
				{
					key: 'blockSort',
					name: '内容块排序',
					desc: '按首字母排序笔记中的内容块。默认关闭。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
