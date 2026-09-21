/**
 * 设置模块的出口。
 *
 * 目录结构：
 * - `model.ts`  数据模型：字段定义、默认值、设置 → 各功能选项的转换
 * - `fields/`   字段表（面板的单一数据源：名字、说明、控件、收敛、显隐）
 * - `tab.ts`    设置面板：声明式定义与旧版手写 DOM 都由字段表生成
 */
export { DEFAULT_SETTINGS, getSpacingOptions } from './model';
export type { ImageTransferSettings } from './model';
export { ImageTransferSettingTab } from './tab';
export { ALL_FIELDS, FIELD_INDEX, SETTINGS_SECTIONS } from './fields';
export type { FieldGroup, FieldSection, FieldSpec, ControlSpec } from './fields';
