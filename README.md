# 野生菌采集鉴定图谱（gbfungiguide）

面向蘑菇野外调查爱好者与地方菌物名录整理者，把「采集点 → 形态描述 → 孢子印 → 菌褶/菌管着生方式 → 鉴定结论」整理成可对照的图谱条目，解决形态特征记不全、描述口径不一、鉴定结论缺乏依据留痕的问题。**纯前端单页应用**，数据全部保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

> 免责声明：本工具仅用于采集记录与形态整理，**内容不可作为食用依据**；鉴定须与权威图鉴和专业人员复核。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21816>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbfungiguide
FRONTEND_PORT=21816
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移，当前 v3：归属 + 乐观版本 + 窗口写锁 + 失败草稿） |
| 多窗口协同 | BroadcastChannel 广播 + IndexedDB 写锁租约（心跳续租，窗口关闭 / 卡死 TTL 自动放开） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21816
npm run build      # 类型检查 + 生产构建
```

## 四、目录结构

```
sologsb-1116/
├── docker-compose.yml          # 顶层 name: gbfungiguide，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # record.ts / spore.ts / point.ts / identify.ts / index.ts
│       ├── stores/             # recordStore / sporeStore / pointStore / identifyStore（Zustand）
│       ├── components/common/  # SporePrintSwatch / TraitsSummary / GillAttachmentTag / GeoPointForm
│       ├── hooks/              # usePersistentStore / useCandidateMatch / useEditLock（窗口写锁组合式函数）
│       ├── concurrency/        # versioning（乐观版本/冲突字段）· locks（租约写锁）· bus（跨窗广播）· client · saveErrors
│       ├── pages/              # AtlasPage / RecordDetailPage / PointsPage / IdentifyPage / ComparePage
│       ├── router/index.ts
│       └── utils/              # spore.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| FungusRecord 菌物条目 | 采集编号、暂定名、菌盖（直径/形状/边缘/质地）、菌肉厚度与变色反应、着生方式、菌褶密度、菌柄、菌环菌托、气味、关联树种 | `records` |
| SporePrint 孢子印 | 印色、印形、获取时长、观察日期、样本干湿度 | `spores` |
| CollectPoint 采集点 | 地点名、经纬度、海拔、植被类型、基物、伴生树种、日期、采集人 | `points` |
| IdentifyLog 鉴定结论 | 结论学名、依据、参考图鉴与页码、置信度、是否待复核、复核人 | `identifies` |

- 数据库名 `gbfungiguide`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史条目补齐「菌肉变色反应」默认值（不变色）；
- `version(3)` 升级迁移为四类历史数据回填**归属（owner）与版本号（version 从 1 起）**：采集点 / 形态条目 / 孢子印归 `recorder`，鉴定结论归 `identifier`，并新增 `locks`（窗口写锁）与 `drafts`（失败恢复草稿）两张表；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 五·补、共用机器上的多人协同规则

队里在同一台机器上多窗口并行录入（一人开图谱总览补形态，另一人开鉴定页写结论），通过四层机制避免晚到的保存把整块带回旧值：

1. **字段归属（owner）**：采集点、形态条目、孢子印归**记录员**；鉴定结论与复核归**鉴定人**。左上角先选身份并署名，数据层按角色硬隔离，越权写入直接拒绝（不是只靠按钮置灰）。
2. **乐观版本（version）**：每行带版本号。打开编辑时记下看到的整行版本，保存时在同一事务内核对；版本对不上就逐字段比对，**点出「会被你这次保存盖回旧值」的字段与「双方都改过」的字段并停下，绝不整行写回**。成功保存版本 +1。保存按钮与留痕徽章上直接显示「基于打开版本 vN」。
3. **窗口写锁（locks）**：同一条目（形态 / 孢子印 / 鉴定结论共用 entry 锁；采集点用 point 锁）被两个窗口同时打开时，只有取得锁的窗口能写，另一个窗口只读并显示写权持有者。锁是 8 秒租约：持锁窗口 2.5 秒心跳续租；窗口正常关闭立即释放，**卡死 / 崩溃则 TTL 到期自动放开**，另有全库过期锁周期清理兜底。
4. **失败恢复（drafts）**：记录员一侧（形态 / 孢子印 / 采集点）保存遇冲突或写库失败时，表单内容自动落为恢复草稿（含打开时版本与失败原因），页面顶部出现横幅，可一键「恢复重来」；不丢弃用户刚填的内容，也不会把旧值写回库。鉴定一侧冲突直接弹窗点字段后停下，恢复入口统一在记录员侧。

跨窗口的数据 / 锁变化经 `BroadcastChannel` 即时广播，其他窗口自动重拉列表、切换只读态；不支持该 API 的旧浏览器退化为 4 秒轮询 + 锁 TTL 兜底。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/atlas` | 图谱总览：网格卡片展示菌盖形态要点、孢子印色块与鉴定状态，按印色/着生方式筛选并新建条目；记录员可「补形态」（需取得条目写锁、按打开版本保存、冲突拦截、失败草稿恢复） |
| `/atlas/:id` | 条目详情：形态描述分区折叠、孢子印观察登记、采集点编辑（含坐标校验）、鉴定留痕；整条目一把写锁，只读态显示写权持有者 |
| `/points` | 采集点管理：经纬度格式校验、条目数与主要基物统计、删除前校验下级条目；编辑走采集点写锁与版本核对 |
| `/identify` | 鉴定工作页：左侧勾选形态特征与印色，右侧实时给出候选名录排序，鉴定人取得写权后新增结论留痕或「修订 / 复核最新一条」（带版本核对） |
| `/compare` | 条目对比：并排最多 3 条，逐项对照菌盖/菌褶菌管/孢子印差异并高亮 |

## 七、候选排序规则

- 权重：着生方式 26、孢子印 22、菌盖形状 12、表面质地 10、菌褶密度 10、菌盖边缘 8、菌肉反应 8、关联树种 4；
- 印色与条目着生方式若属于该印色的先验组合（如白色↔离生/弯生），计半分；
- 排序先比总分，总分相同则优先展示着生方式一致的条目。
