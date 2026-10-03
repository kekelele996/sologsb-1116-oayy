import type { FungusRecord } from './record'
import type { CollectPoint } from './point'
import type { SporePrint } from './spore'
import type { IdentifyLog } from './identify'

/**
 * 字段归属划分：
 * - 记录员阵营：采集点、形态（FungusRecord 主体）、孢子印
 * - 鉴定人阵营：结论与复核（IdentifyLog）
 * 两边保存时只写自己阵营的字段，互不串写。
 */

/** FungusRecord 中归记录员的字段（形态 + 采集信息） */
export const RECORDER_RECORD_FIELDS = [
  'code',
  'tempName',
  'fruitBodyCount',
  'pointId',
  'capDiameter',
  'capShape',
  'capMargin',
  'capTexture',
  'fleshThickness',
  'fleshReaction',
  'attachment',
  'gillDensity',
  'stipeLength',
  'stipeDiameter',
  'ring',
  'volva',
  'odor',
  'hostTree',
  'collectDate',
  'collector',
  'note'
] as const satisfies readonly (keyof FungusRecord)[]

/** CollectPoint 中归记录员的字段 */
export const RECORDER_POINT_FIELDS = [
  'name',
  'longitude',
  'latitude',
  'altitude',
  'vegetation',
  'substrate',
  'companionTrees',
  'collectDate',
  'collector'
] as const satisfies readonly (keyof CollectPoint)[]

/** SporePrint 中归记录员的字段 */
export const RECORDER_SPORE_FIELDS = [
  'color',
  'shape',
  'hours',
  'observeDate',
  'moisture'
] as const satisfies readonly (keyof SporePrint)[]

/** IdentifyLog 中归鉴定人的字段（结论与复核） */
export const IDENTIFIER_LOG_FIELDS = [
  'conclusion',
  'basis',
  'referenceBook',
  'referencePage',
  'confidence',
  'needReview',
  'reviewer',
  'date'
] as const satisfies readonly (keyof IdentifyLog)[]

/** 字段中文名（用于冲突提示） */
export const FIELD_LABELS: Record<string, string> = {
  code: '采集编号',
  tempName: '暂定名',
  fruitBodyCount: '子实体数量',
  pointId: '采集点',
  capDiameter: '菌盖直径',
  capShape: '菌盖形状',
  capMargin: '菌盖边缘',
  capTexture: '表面质地',
  fleshThickness: '菌肉厚度',
  fleshReaction: '菌肉变色反应',
  attachment: '着生方式',
  gillDensity: '菌褶密度',
  stipeLength: '菌柄长度',
  stipeDiameter: '菌柄直径',
  ring: '菌环',
  volva: '菌托',
  odor: '气味',
  hostTree: '关联树种',
  collectDate: '采集日期',
  collector: '采集人',
  note: '备注',
  name: '采集点名称',
  longitude: '经度',
  latitude: '纬度',
  altitude: '海拔',
  vegetation: '植被类型',
  substrate: '基物',
  companionTrees: '伴生树种',
  color: '印色',
  shape: '印形',
  hours: '获取时长',
  observeDate: '观察日期',
  moisture: '样本干湿度',
  conclusion: '结论学名',
  basis: '依据',
  referenceBook: '参考图鉴',
  referencePage: '页码',
  confidence: '置信度',
  needReview: '待复核',
  reviewer: '复核人',
  date: '鉴定日期'
}
