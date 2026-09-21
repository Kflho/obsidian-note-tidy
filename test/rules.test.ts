/**
 * 规则登记表核对（`src/rule-registry.ts`）
 *
 * 运行：`npm test`
 * 重新生成文档：`node test/run-tests.mjs --update-rules-doc`
 *
 * 排版规则散在十几个模块里，出处靠注释里的"英文符号 1""标记命名 4"标着 —— 规范改一轮
 * 注释就会漂（`latex 符号格式` 那一节已经并进 `通用符号` 并重新编号）。这个测试把
 * 「规范出处 ↔ 开关 ↔ 实现 ↔ 测试」四样东西逐条对上：
 *
 *   1. 每条规则的 ID 唯一，状态不是 done 时必须写备注（说明差在哪）
 *   2. 规范出处的那一节、那一条真的存在
 *      —— 规范笔记在 vault 里，拿不到时**跳过**（CI 上检出的是独立仓库，不该因此失败）
 *   3. 开关真的存在：`switchKeys` 是设置字段，且设置面板里有这一项；反过来，
 *      每个设置字段都得有规则用着（有开关却没规则 = 没人知道它管什么）
 *   4. 实现真的存在：`impl.file` 存在，里面能找 `impl.symbols` 里的每一个声明
 *   5. 测试真的存在：`tests` 里的文件路径都能找到
 *   6. `docs/规则登记表.md` 与这张表一致（只改表不重新生成文档，这里会失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_RULES, RULE_SECTIONS, SPEC_NOTE_PATH, renderRuleRegistryDoc } from '../src/rule-registry';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { FIELD_INDEX } from '../src/settings/fields';

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];
const notes: string[] = [];

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

const exists = (file: string): boolean => fs.existsSync(path.resolve(file));

// -------------------------------------------------------------------- 1. 表本身
const ids = ALL_RULES.map(rule => rule.id);
check('规则 ID 唯一', ids.length, new Set(ids).size);
check('每条规则都有名字', ALL_RULES.filter(rule => !rule.name).map(rule => rule.id), []);
check('每条规则都指向一个实现文件', ALL_RULES.filter(rule => !rule.impl.file).map(rule => rule.id), []);
check('每条规则至少列一个实现符号', ALL_RULES.filter(rule => rule.impl.symbols.length === 0).map(rule => rule.id), []);
check(
	'状态不是 done 时必须写备注',
	ALL_RULES.filter(rule => rule.status !== 'done' && !rule.note).map(rule => rule.id),
	[]
);
check('分节都非空', RULE_SECTIONS.filter(section => section.rules.length === 0).map(section => section.heading), []);
check('平面清单与分节一致', ALL_RULES.length, RULE_SECTIONS.reduce((sum, section) => sum + section.rules.length, 0));

// -------------------------------------------------------------------- 2. 规范出处
/** 把规范笔记切成「章节全路径 → 该节正文行」 */
function parseSpecSections(text: string): Map<string, string[]> {
	const sections = new Map<string, string[]>();
	const stack: string[] = [];
	let current: string[] | null = null;

	for (const line of text.split('\n')) {
		const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
		if (heading) {
			const level = (heading[1] ?? '').length;
			const title = (heading[2] ?? '').trim();
			stack.length = level - 1;
			stack[level - 1] = title;
			const full = stack.slice(0, level).join(' / ');
			current = [];
			sections.set(full, current);
			continue;
		}
		if (current) current.push(line);
	}
	return sections;
}

const specFile = path.resolve(SPEC_NOTE_PATH);
const specText = exists(SPEC_NOTE_PATH) ? fs.readFileSync(specFile, 'utf8') : null;
const rulesWithSpec = ALL_RULES.filter(rule => rule.spec !== null);

if (specText === null) {
	notes.push(`跳过规范出处核对：找不到规范笔记（${specFile}）。CI 上检出的是独立仓库，属正常；本地可用 NOTE_TIDY_SPEC 指定路径。`);
} else {
	const sections = parseSpecSections(specText);
	check('有规范出处的规则都标了章节', rulesWithSpec.filter(rule => !rule.spec?.path).map(rule => rule.id), []);

	for (const rule of rulesWithSpec) {
		const spec = rule.spec!;
		const body = sections.get(spec.path);
		checkTrue(
			`${rule.id}：规范里有这一节`,
			body !== undefined,
			`找不到章节「${spec.path}」（现有章节如：${[...sections.keys()].slice(0, 3).join(' / ')} …）`
		);
		if (!body) continue;
		// 规范用顶格的 `1.` `2.` 编号；子条目是缩进的，不算
		const itemLine = new RegExp(`^${spec.item}\\.`);
		checkTrue(
			`${rule.id}：规范该节里有第 ${spec.item} 条`,
			body.some(line => itemLine.test(line)),
			`「${spec.path}」里没有 ${spec.item}. 开头的条目`
		);
	}
	notes.push(`规范出处核对：${rulesWithSpec.length} 条规则对着 ${specFile} 逐条查过。`);
}

// -------------------------------------------------------------------- 3. 开关
const settingsKeys = Object.keys(DEFAULT_SETTINGS);
const fieldKeys = new Set(FIELD_INDEX.keys());
const usedSwitches = new Set<string>();

for (const rule of ALL_RULES) {
	for (const key of rule.switchKeys) {
		usedSwitches.add(key);
		checkTrue(
			`${rule.id}：开关 ${key} 是设置字段`,
			settingsKeys.includes(key),
			`DEFAULT_SETTINGS 里没有 ${key}`
		);
		checkTrue(
			`${rule.id}：开关 ${key} 在设置面板里有对应项`,
			fieldKeys.has(key),
			`设置字段表（src/settings/fields/）里没有 ${key}`
		);
	}
}

check(
	'每个设置字段都有规则用着（没有"没人知道管什么"的开关）',
	settingsKeys.filter(key => !usedSwitches.has(key)),
	[]
);

// -------------------------------------------------------------------- 4. 实现
for (const rule of ALL_RULES) {
	checkTrue(`${rule.id}：实现文件存在`, exists(rule.impl.file), `找不到 ${rule.impl.file}`);
	if (!exists(rule.impl.file)) continue;

	const source = fs.readFileSync(path.resolve(rule.impl.file), 'utf8');
	for (const symbol of rule.impl.symbols) {
		// 导出与否都行：只要求这个名字在该文件里有一处声明
		const declaration = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|const|class|interface|type|let)\\s+${symbol}\\b`);
		checkTrue(
			`${rule.id}：${rule.impl.file} 里有 ${symbol}`,
			declaration.test(source),
			`${rule.impl.file} 里没有声明 ${symbol}（改名后记得同步规则登记表）`
		);
	}
}

// -------------------------------------------------------------------- 5. 测试
for (const rule of ALL_RULES) {
	for (const test of rule.tests) {
		checkTrue(`${rule.id}：测试文件存在`, exists(test), `找不到 ${test}`);
	}
}

// -------------------------------------------------------------------- 6. 文档同步
const DOC_PATH = 'docs/规则登记表.md';
const rendered = renderRuleRegistryDoc();
const normalize = (text: string): string => text.replace(/\r\n/g, '\n');

if (process.argv.includes('--update-rules-doc')) {
	fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
	fs.writeFileSync(DOC_PATH, rendered);
	notes.push(`已按当前表重新生成 ${DOC_PATH}`);
} else {
	const current = exists(DOC_PATH) ? normalize(fs.readFileSync(DOC_PATH, 'utf8')) : null;
	checkTrue(
		'规则登记表文档与表一致',
		current === normalize(rendered),
		current === null
			? `缺少 ${DOC_PATH}：运行 node test/run-tests.mjs --update-rules-doc 生成`
			: `${DOC_PATH} 与 src/rule-registry.ts 不一致：运行 node test/run-tests.mjs --update-rules-doc 重新生成`
	);
}

// -------------------------------------------------------------------- 报告
for (const note of notes) console.log(`ℹ️  ${note}`);
console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log('\n❌ ' + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
