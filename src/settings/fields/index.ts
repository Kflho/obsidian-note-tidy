import { IMAGE_SECTION } from './image';
import { INTERFACE_SECTION } from './interface';
import { TEXT_SECTION } from './text';
import type { FieldSection, FieldSpec } from './types';

/**
 * 设置面板的完整结构：三个页面，顺序 = 面板上从上到下的顺序。
 *
 * 信息架构（2026-09 重排过一次，加新设置前先读这段）：
 *
 * 1. **图片** —— 所有跟图片文件有关的（落盘位置 / 命名 / 转格式 / 粘贴 / 大小 / 一键整理）；
 * 2. **文本排版** —— 排版流水线每一步的开关，组顺序照着流水线走；
 * 3. **菜单与交互** —— 入口放哪儿：右键菜单项、隐藏名单、Ctrl+C、状态栏。
 *
 * 三条规矩：
 * - **按"用户要干什么"分页，不按代码模块分页**（`image/*.ts` / `text/*.ts` 是给维护者看的）；
 * - 一个页面里**同类的事必须挨着**，并且用组标题说清是哪一类 —— 顶层不再平铺十几条
 *   （2026-09 用户报过"功能加了一大堆，设置面板已经乱了"）；
 * - 每个设置项**只属于一处**（`test/settings.test.ts` 会核对不多不少）。
 *
 * 加一个设置项只需要在 image.ts / text.ts / interface.ts 里加一条，
 * 声明式定义与旧版手写 DOM 会同时长出来。
 */
export const SETTINGS_SECTIONS: FieldSection[] = [
	IMAGE_SECTION,
	TEXT_SECTION,
	INTERFACE_SECTION,
];

/** key → 字段，供读取 / 写入控件值时查收敛规则 */
export const FIELD_INDEX: Map<string, FieldSpec> = (() => {
	const index = new Map<string, FieldSpec>();
	for (const section of SETTINGS_SECTIONS) {
		const groups = section.fields ? [{ heading: section.heading, fields: section.fields }] : section.groups ?? [];
		for (const group of groups) {
			for (const field of group.fields) {
				index.set(field.key, field);
			}
		}
	}
	return index;
})();

/**
 * 平面化的字段清单（按面板顺序）。
 * 测试用它核对"每个设置字段都有且只有一条定义"。
 */
export const ALL_FIELDS: FieldSpec[] = [...FIELD_INDEX.values()];

export type { FieldGroup, FieldSection, FieldSpec, ControlSpec } from './types';
