/**
 * 声明式设置（Obsidian 1.13+）的覆盖检查
 *
 * Obsidian 1.13 起，只要 PluginSettingTab 实现了 getSettingDefinitions()，
 * 设置面板就由这份定义渲染，它同时也是设置搜索的索引来源；display() 退化成
 * 旧版本的兜底（见 obsidian.d.ts 的说明）。两边一旦漏项，用户就会遇到
 * "某个开关不见了"。这里检查：
 *
 *   1. 每个设置字段都有且只有一条声明式定义（多了少了都算失败）
 *   2. 每条定义都有名字；下拉框的默认值必须在自己的选项里
 *   3. 读取控件值返回的是下拉框认得的合法值（data.json 里可能有旧版本脏数据）
 *   4. 依赖其它开关的 visible / disabled 谓词跟着设置变化
 *   5. 写入控件值时收敛脏数据并存盘
 */
import type { App } from "obsidian";
import { DEFAULT_SETTINGS, ImageTransferSettingTab } from "../src/settings";
import type { ImageTransferSettings } from "../src/settings";
import { DEFAULT_SPACING_OPTIONS } from "../src/spacing";
import type ImageTransferPlugin from "../src/main";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n  ${detail}`);
}

function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

// ---------------------------------------------------------------- 测试替身
type AnyDefinition = {
	name?: string;
	heading?: string;
	type?: string;
	items?: AnyDefinition[];
	visible?: boolean | (() => boolean);
	control?: {
		type: string;
		key: string;
		options?: Record<string, string>;
		defaultValue?: unknown;
		disabled?: boolean | (() => boolean);
	};
};

/** 造一个只带 settings / saveSettings 的插件替身，不需要真的 onload */
function createTab(overrides?: Partial<ImageTransferSettings>) {
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS, ...overrides };
	let saves = 0;
	const plugin = {
		settings,
		saveSettings: async () => { saves++; },
	} as unknown as ImageTransferPlugin;
	const tab = new ImageTransferSettingTab({} as App, plugin);
	return { tab, settings, saveCount: () => saves };
}

/** 展平定义树：分组 / 分页只提供结构，真正的设置项都挂在 control 上 */
function collectLeaves(items: AnyDefinition[], out: AnyDefinition[] = []): AnyDefinition[] {
	for (const item of items) {
		if (item.items) collectLeaves(item.items, out);
		else out.push(item);
	}
	return out;
}

function defsOf(tab: ImageTransferSettingTab): AnyDefinition[] {
	return collectLeaves(tab.getSettingDefinitions());
}

function byKey(defs: AnyDefinition[], key: string): AnyDefinition | undefined {
	return defs.find(def => def.control?.key === key);
}

// -------------------------------------------------------------------- 用例
const { tab, settings } = createTab();
const definitions = defsOf(tab);
const keys = definitions.map(def => def.control?.key);

// 1. 字段覆盖：不多不少
const expectedKeys = Object.keys(DEFAULT_SETTINGS);
const missing = expectedKeys.filter(key => !keys.includes(key));
const unknown = keys.filter(key => !expectedKeys.includes(key as keyof ImageTransferSettings));
check("声明式设置覆盖全部字段（缺项）", missing, []);
check("声明式设置没有多余字段", unknown, []);
check("每个字段只有一条定义", keys.length, new Set(keys).size === keys.length ? keys.length : -1);

// 2. 名字与下拉框选项
check("每条定义都有名字", definitions.filter(def => !def.name).length, 0);
check("设置项分组都有标题", (tab.getSettingDefinitions() as unknown as AnyDefinition[])
	.filter(item => item.type === 'group' && !item.heading).length, 0);

for (const def of definitions) {
	const control = def.control;
	if (!control) {
		checkTrue(`设置项 ${def.name} 有控件`, false, `缺少 control：${JSON.stringify(def)}`);
		continue;
	}
	if (control.type !== 'dropdown') continue;
	const options = Object.keys(control.options ?? {});
	checkTrue(
		`${def.name}：默认值在下拉选项里`,
		options.includes(String(control.defaultValue)),
		`默认值 ${String(control.defaultValue)} 不在选项 ${options.join(' / ')} 中`,
	);
	// 3. 读取控件值返回合法选项（旧 data.json 可能是脏数据）
	const value = tab.getControlValue(control.key);
	checkTrue(
		`${def.name}：读到的值在选项里`,
		options.includes(String(value)),
		`读到 ${String(value)}，选项 ${options.join(' / ')}`,
	);
}

// 4. 依赖其它开关的谓词
const customFolder = byKey(definitions, 'customAttachmentFolder');
const visible = customFolder?.visible as () => boolean;
check("附件文件夹名称：默认（跟随系统）不显示", visible(), false);
check("附件文件夹名称：自定义时显示",
	(defsOf(createTab({ attachmentLocation: 'custom' }).tab)
		.find(def => def.control?.key === 'customAttachmentFolder')
		?.visible as () => boolean)(), true);

const tagSort = byKey(definitions, 'tagSort')?.control?.disabled as () => boolean;
check("标签排序：标签排版关闭时不可用", tagSort(), true);
check("标签排序：标签排版开启时可用",
	(defsOf(createTab({ tagLayout: true }).tab).find(def => def.control?.key === 'tagSort')
		?.control?.disabled as () => boolean)(), false);

const blankLine = byKey(definitions, 'chatBlankLineBetweenMessages')?.control?.disabled as () => boolean;
check("消息间空行：头部信息齐全时不可用", blankLine(), true);
check("消息间空行：头部信息全关时可用",
	(defsOf(createTab({ chatShowUsername: false, chatShowDate: false, chatShowTime: false }).tab)
		.find(def => def.control?.key === 'chatBlankLineBetweenMessages')
		?.control?.disabled as () => boolean)(), false);

// 5. 写入时收敛脏数据并保存
const { tab: writeTab, settings: written, saveCount } = createTab();
await writeTab.setControlValue('spacingCjkLatin', '不是合法值');
check("脏数据收敛为默认值", written.spacingCjkLatin, DEFAULT_SPACING_OPTIONS.cjkLatin);
await writeTab.setControlValue('spacingCjkDigit', 'space');
check("合法值原样写入", written.spacingCjkDigit, 'space');
await writeTab.setControlValue('textLeadingIndentFix', 'strict');
check("缩进模式写入", written.textLeadingIndentFix, 'strict');
await writeTab.setControlValue('imageNamePreset', '图片 {YYYY}');
check("普通字段直接写入", written.imageNamePreset, '图片 {YYYY}');
checkTrue("写入后触发存盘", saveCount() >= 4, `saveSettings 调用 ${saveCount()} 次`);
check("默认设置未被测试污染", settings.imageNamePreset, DEFAULT_SETTINGS.imageNamePreset);

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
