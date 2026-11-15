import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from '../../text/spacing';
import { resolveLeadingIndentMode } from '../../text/indent';
import type { FieldSection } from './types';

/**
 * 「文本排版」一页：排版流水线每一步的开关与选项。
 *
 * 分组的顺序**照着流水线走**（见 `text/pipeline.ts` 文件头）：
 * 行首与标记 → 聊天记录 → Bangumi 讨论 → 公式 → 空格（文字间距 / 标点与符号）→ 标签与板块。
 * 这样"某一处排版不满意"时能顺着页面从上往下找到那一步，而不用记模块名。
 *
 * 每一节的说明文字都对着笔记里的《排版格式》规范写，
 * 改规则时先改规范、再改这里的文案、最后改对应模块的实现（见 rule-registry.ts）。
 */

export const TEXT_SECTION: FieldSection = {
	type: 'page',
	heading: '文本排版',
	desc: '按排版流水线顺序列出开关。',
	groups: [
		{
			heading: '行首与标记',
			fields: [
				{
					key: 'textLeadingIndentFix',
					name: '行首缩进修复',
					desc: '修复行首缩进与标记空白。',
					control: {
						type: 'dropdown',
						options: {
							smart: '智能：列表子项保留，其余行首空格删掉 (推荐)',
							strict: '严格：行首只留 tab，空格全删',
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
			heading: '聊天记录',
			fields: [
				{
					key: 'chatShowUsername',
					name: '显示用户名',
					desc: '默认开；关闭后只留正文。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatShowDate',
					name: '显示日期',
					desc: '默认开；日期写在每条的头部。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatShowTime',
					name: '显示时间',
					desc: '默认开；时间写在每条的头部。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatIndent',
					name: '正文缩进',
					desc: '聊天记录正文的缩进方式。',
					control: {
						type: 'dropdown',
						options: {
							tab: '制表符 (tab)',
							'2': '2 个空格',
							'4': '4 个空格',
							none: '不缩进',
						},
					},
				},
				{
					key: 'chatImageOrder',
					name: '图文消息中图片的位置',
					desc: '聊天记录中图片与文字的先后。',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原顺序',
							above: '图片在上方',
							below: '图片在下方',
						},
					},
				},
				{
					key: 'chatSortByTime',
					name: '相邻消息按时间排序',
					desc: '默认开；只在同一人的相邻消息之间调整顺序。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatStripMentions',
					name: '去掉 @ 提及',
					desc: '开启后聊天记录中的 @ 提及不写进笔记。',
					control: { type: 'toggle' },
				},
				{
					key: 'chatBlankLineBetweenMessages',
					name: '消息之间插入空行',
					desc: '默认关；只影响纯文字消息，带图的消息不拆。',
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
					desc: '默认开；楼层号写在每层开头。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiShowTime',
					name: '显示楼层时间',
					desc: '默认开；时间取自楼层头部。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiShowSignature',
					name: '保留签名',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiStripReactions',
					name: '去掉贴贴与页面控件',
					desc: '默认开；只删计数与控件，正文不动。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiStripSmiles',
					name: '去掉表情',
					desc: '开启后表情文字（如 [表情]）不写进笔记。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiLinkUsers',
					name: '用户名带主页链接',
					desc: '默认关；开启后点用户名可跳回主页。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiImageMode',
					name: '网页导入时的图片',
					desc: '选择保留链接或收进仓库。',
					control: {
						type: 'dropdown',
						options: {
							link: '保留远程链接（默认）',
							import: '收进仓库（静态图片；GIF / 视频留链接）',
						},
					},
				},
				{
					key: 'bangumiTitleMode',
					name: '网页导入时的标题',
					desc: '选择丢弃、插为二级标题，或重命名当前文件。',
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
					desc: '同一条回复里的段落之间是否留空行。',
					control: { type: 'toggle' },
				},
				{
					key: 'bangumiBlankLineBetweenPosts',
					name: '不同楼层之间留空行',
					desc: '',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '公式',
			fields: [
				{
					key: 'textMathWrapSymbols',
					name: '正文数学符号自动加公式',
					desc: '把正文里的数学符号包成公式。',
					control: { type: 'toggle' },
				},
				{
					key: 'mathLayout',
					name: '公式排版',
					desc: '整理公式代码的空格与换行。',
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
					desc: '默认开；写成「中文 English」。',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽 (推荐)',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.cjkLatin),
				},
				{
					key: 'spacingCjkDigit',
					name: '中文与数字之间',
					desc: '默认关；开启后写成「第 3 章」。',
					control: {
						type: 'dropdown',
						options: {
							none: '不留空格 (按笔记规则，推荐)',
							space: '空一个字宽',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveCjkDigitMode(value),
				},
				{
					key: 'spacingLatinDigit',
					name: '英文与数字之间',
					desc: '默认保持原样；需要时改成空一格。',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原样 (推荐)',
							space: '空一个字宽',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.latinDigit),
				},
				{
					key: 'spacingMathText',
					name: '公式与文字之间',
					desc: '默认开；写成「文字 $x$ 文字」。',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽 (推荐)',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.mathText),
				},
				{
					key: 'spacingChapterTitle',
					name: '标题标记与标题内容之间',
					desc: '默认开；写成「## 标题」。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标点与符号',
			fields: [
				{
					key: 'spacingFullPunct',
					name: '全角标点两侧不留空格',
					desc: '默认开；写成「你好，世界」。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfPunct',
					name: '半角标点前不留空格、后空一格',
					desc: '默认开；写成「a, b」。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingBracketInner',
					name: '括号前后都没有空格',
					desc: '括号内侧不留空格。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingDigitUnit',
					name: '数字与单位之间空一格',
					desc: '默认关；开启后写成「10 km」。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfToFullPunct',
					name: '标点全半角按语境',
					desc: '默认开；中文句子用全角，英文与公式用半角。',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingSymbolPad',
					name: '符号自己的空格规则',
					desc: '按符号规则整理空格。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标签与板块',
			fields: [
				{
					key: 'tagLayout',
					name: '标签排版',
					desc: '把标签移到块尾。',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'tagSort',
					name: '标签排序',
					desc: '标签按首字母排序。',
					control: { type: 'toggle' },
					disabled: (settings) => !settings.tagLayout,
				},
				{
					key: 'blockSort',
					name: '内容板块排版',
					desc: '按首字母排序内容块。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
