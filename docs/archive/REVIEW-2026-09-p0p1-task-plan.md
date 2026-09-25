# 代码库全量审阅计划

## 目标

完整理解当前仓库的运行方式、模块关系、关键业务流程和测试覆盖，并输出有证据、可执行、按优先级排序的优化建议；本轮不修改业务代码。

## 范围

- [x] 逐个通读仓库内所有纳入版本控制的源文件
- [x] 补充阅读配置、脚本、文档、测试和 CI 文件
- [x] 识别 `.goatgauge-data`、`.tmp` 等生成物并与业务代码分离
- [x] 检查正确性、安全性、性能、架构、可测试性和交付质量
- [x] 执行静态门禁、单元测试、生产构建和依赖审计
- [x] 将确定性缺陷、静态风险和可选架构建议分开记录

## 实施阶段（2026-09-25）

- [x] 阶段 6：按 `2026-09-24-p0-p1-hardening-plan.md` 完成 P0/P1 修复（Task 1–11）
- [x] 全部 P0、全部 P1 落地；部署版本 `57b8d4d0`；实施状态见 `findings.md` §9

## 阶段状态

- [x] 阶段 1：盘点仓库与项目边界
- [x] 阶段 2：通读全部源文件并建立模块/数据流地图
- [x] 阶段 3：检查测试、构建、运行和依赖质量
- [x] 阶段 4：按严重程度整理优化建议与实施顺序
- [x] 阶段 5：复核证据并形成最终报告

## 完成证据

- 跟踪文件：155；D1 migration：24。
- `npm run check`：exit 0。
- `npm run lint`：exit 0，25 warnings、0 errors。
- `npm run format:check`：exit 0。
- `npm test -- --run`：exit 0，303 passed、9 skipped，19 files passed、1 skipped。
- `npm run build`：exit 0，但报告大 chunk 警告。
- `npm audit --package-lock-only --json`：exit 1，开发依赖 1 critical、4 high、3 moderate。
- `npm audit --omit=dev`：exit 0，生产依赖 0 vulnerabilities。
- quick 排序快照问题已用当前代码复现。
- 交付报告：`findings.md`；执行记录：`progress.md`。

## 成功标准核对

- [x] 覆盖所有纳入版本控制的源文件，而不是只读入口文件
- [x] 每条关键建议都绑定到具体文件/代码证据
- [x] 区分确定性缺陷、架构债务、性能风险和可选改进
- [x] 给出可落地的优先级、收益、代价与验证方式
- [x] 未将静态风险误述为已在生产环境复现
- [x] 未声称业务代码已修复或仓库已经安全

## 约束

- 本轮只分析，不改业务代码
- 外部资料不作为代码事实；如使用，仅用于一般性最佳实践对照
- 生成物不作为业务源码逐个审阅，除非它们被构建/运行流程实际使用
- 不在生产环境执行 destructive migration 或 deploy
