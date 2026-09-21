import { IMAGE_SECTIONS } from './image';
import { TEXT_SECTION } from './text';
import type { FieldSection, FieldSpec } from './types';

/**
 * 设置面板的完整结构：顺序 = 面板上从上到下的顺序。
 *
 * 加一个设置项只需要在这里（或 image.ts / text.ts）加一条，
 * 声明式定义与旧版手写 DOM 会同时长出来。
 */
export const SETTINGS_SECTIONS: FieldSection[] = [...IMAGE_SECTIONS, TEXT_SECTION];

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
