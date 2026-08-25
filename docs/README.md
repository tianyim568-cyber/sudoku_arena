<!-- IMPORTANT — original spec vs. actual implementation (added 2026-08-25).
     The body of this spec was written 2026-07-10 and describes the INTENDED
     architecture at design time. The actual implementation diverges from it
     in several major ways. The bullet list below summarizes the gaps; for
     the authoritative current state, see the "August 2026 Updates" section
     at the top of ../FRONTEND_DOCUMENTATION.md and ../BACKEND_DOCUMENTATION.md.
     When the body below contradicts the August 2026 update, trust the update. -->
<!--
     Known spec-vs-code gaps (see ISSUE-001 in louise/KNOWN_ISSUES.md):
       1. Frontend stack: spec recommends TypeScript + Zustand; actual code
          is plain JavaScript with React hooks (no Zustand).
       2. WebSocket protocol: spec recommends STOMP; actual code uses
          Socket.IO (client/src/ws/useGameSocket.js, server ws/ setup).
       3. Tournament vs Competition naming: spec uses Tournament everywhere;
          actual code migrated Tournament -> Competition in 2026-08
          (see JOURNAL_MODIFICATIONS.md Phase 2/Phase 12).
       4. Tournament routes: spec assumes /tournaments; actual code uses
          /competitions, /dashboard/*, /display/:token.
       5. Pages: spec describes a flat page set; actual code has a dashboard
          architecture with sidebar layout (DashboardLayout.jsx).
     For the full list, see ../FRONTEND_DOCUMENTATION.md §"August 2026 Updates".

     Path-portability note (2026-08-25): the file links in the table
     below used to point to C:/Users/Administrator/Desktop/project_3/docs/
     (the original developer's machine). They are now relative links so
     the doc works after a git clone on any machine.
-->

# 实时多人在线数独比赛管理平台 — 软件规格说明文档

> **⚠️ 重要提示（2026-08-25）：** 本文档为 2026-07-10 撰写的原始规格说明，描述的是设计意图，**并非实际代码现状**。实际实现与规格在多处存在偏差（前端栈、WebSocket 协议、命名约定、路由结构、页面架构）。请以仓库根目录的 `FRONTEND_DOCUMENTATION.md` 和 `BACKEND_DOCUMENTATION.md` 顶部的 "August 2026 Updates" 章节为权威来源。当本规格与该章节冲突时，**以 August 2026 Updates 为准**。详见上方 HTML 注释中的 "Known spec-vs-code gaps" 列表与 `louise/KNOWN_ISSUES.md` ISSUE-001。

## 文档信息

| 项目 | 内容 |
|------|------|
| 项目名称 | 实时多人在线数独比赛管理平台（Real-time Multiplayer Competition Management Platform for Sudoku Tournaments） |
| 文档版本 | V1.0 |
| 创建日期 | 2026-07-10 |
| 文档性质 | MVP 软件规格说明（原始设计意图，非实现现状） |

## 文档目录

| 编号 | 文档 | 文件 |
|------|------|------|
| 第一部分 | 项目介绍 | [Part1-项目介绍.md](Part1-项目介绍.md) |
| 第二部分 | 产品需求分析 | [Part2-产品需求分析.md](Part2-产品需求分析.md) |
| 第三部分 | 功能需求 | [Part3-功能需求.md](Part3-功能需求.md) |
| 第四部分 | 非功能需求 | [Part4-非功能需求.md](Part4-非功能需求.md) |
| 第五部分 | 推荐技术架构 | [Part5-推荐技术架构.md](Part5-推荐技术架构.md) |
| 第六部分 | 数据库初步设计 | [Part6-数据库设计.md](Part6-数据库设计.md) |
| 第七部分 | REST API 建议 | [Part7-REST-API.md](Part7-REST-API.md) |
| 第八部分 | WebSocket 事件设计 | [Part8-WebSocket事件设计.md](Part8-WebSocket事件设计.md) |
| 第九部分 | 开发建议 | [Part9-开发建议.md](Part9-开发建议.md) |

## 文档摘要

**第一部分：项目介绍** — 明确了项目背景（官方数独比赛缺少专业管理系统）、系统定位（面向正式比赛的实时管理平台，而非练习网站）、六条核心设计原则（MVP 优先、服务器权威、实时同步优先等）、MVP 功能清单和明确排除的功能、以及 V2-V4+ 的扩展路线图。

**第二部分：产品需求分析** — 定义了三类用户角色（管理员/裁判/选手）及其权限矩阵，梳理了完整的赛前准备→比赛进行→比赛结束业务流程，详细描述了三轮赛制的流程和规则（九九归一的线索聚合、轮转接力的题目轮转与即时分配、齐心协力的多人实时编辑），列出了主要页面和模块职责。

**第三部分：功能需求** — 按七大模块（用户管理、比赛管理、比赛引擎、房间管理、实时同步、题库管理、计分系统）逐项列出功能需求，包括功能编号、优先级、角色、详细说明和业务规则。特别详细地描述了比赛引擎的三轮流程执行逻辑、状态机设计和题目轮转机制。

**第四部分：非功能需求** — 涵盖性能（响应时间、并发能力、计时精度）、安全（认证授权、数据安全、比赛公平性）、可靠性（可用性、容错、数据持久化）、可维护性（代码质量、UI 可替换性）、可扩展性（架构和业务两层、MVP 底线约束）、可测试性（测试策略和可测试性设计）。

**第五部分：推荐技术架构** — 选择 Modular Monolith + 前后端分离架构，详细规划了前端分层架构和目录结构（React + TypeScript + Vite + TailwindCSS + Zustand）、后端模块化包结构（Package by Feature）、模块依赖关系、WebSocket STOMP 协议和通道设计，并解释了每个技术选型的原因和架构风险缓解措施。

**第六部分：数据库设计** — 列出了六大领域的主要实体（User、Tournament、Round、Puzzle、Team、Submission 等）、字段定义、实体关系图、唯一约束。特别设计了 PlayerPuzzleAssignment 表支撑第二轮轮转逻辑，PuzzleRelation 表支撑第一轮线索关联。

**第七部分：REST API 建议** — 定义了统一响应格式和错误码体系，列出了认证、用户管理、比赛管理、轮次管理、题目管理、队伍管理、比赛控制、答案提交、分数查询、房间状态共 30+ 个 API，每个 API 包含请求体、响应体和错误码。

**第八部分：WebSocket 事件设计** — 设计了客户端发送事件（5 个）和服务器发送事件（20 个），按广播/组播/定向三种通道分类，每个事件包含详细的 payload 格式和用途说明。特别设计了三轮赛制的完整事件流程示例。

**第九部分：开发建议** — 规划了 5 个开发阶段（10 周），定义了功能优先级矩阵（P0/P1/P2），列出了「以后再做」的功能清单及架构预留措施，分析了技术/业务/项目三方面风险及缓解措施，定义了 6 个里程碑，建议了最小团队配置和协作要点。
