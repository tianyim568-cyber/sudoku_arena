# 第五部分：推荐技术架构

## 5.1 整体架构

### 5.1.1 架构风格

采用**前后端分离的单体应用架构**（Modular Monolith with Separated Frontend）。

```
┌──────────────────────────────────────────────────────────┐
│                       客户端层                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              React + TypeScript                     │ │
│  │   ┌──────────┬──────────┬───────────────────────┐  │ │
│  │   │ 管理员 UI │ 裁判 UI  │ 选手 UI              │  │ │
│  │   └──────────┴──────────┴───────────────────────┘  │ │
│  │   ┌──────────────────────────────────────────────┐  │ │
│  │   │  共享层：API Client / WS Client / Components │  │ │
│  │   └──────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (REST) + WebSocket
┌──────────────────────┴───────────────────────────────────┐
│                      服务端层                             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Spring Boot 应用                        │ │
│  │   ┌────────┬────────┬────────┬────────┬─────────┐  │ │
│  │   │用户管理 │比赛管理 │比赛引擎│房间管理 │题库管理  │  │ │
│  │   └────────┴────────┴────────┴────────┴─────────┘  │ │
│  │   ┌────────┬────────┐                              │  │
│  │   │计分系统 │实时同步 │                              │  │
│  │   └────────┴────────┘                              │  │
│  │   ┌──────────────────────────────────────────────┐  │ │
│  │   │  基础设施：Security / WebSocket / JPA / JWT   │  │ │
│  │   └──────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │ JDBC
┌──────────────────────┴───────────────────────────────────┐
│                      数据层                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   PostgreSQL                         │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 5.1.2 为什么选择单体架构

| 考量 | 单体架构 | 微服务架构 | MVP 选择 |
|------|----------|-----------|----------|
| 开发效率 | 高（无服务间通信） | 低（需定义接口、处理分布式问题） | 单体 |
| 运维复杂度 | 低（一个进程） | 高（多进程、服务发现、链路追踪） | 单体 |
| 部署成本 | 低 | 高 | 单体 |
| 扩展灵活性 | 低 | 高 | N/A（MVP 不需要） |
| 团队要求 | 低 | 高（需要 DevOps 能力） | 单体 |

> 设计原因：MVP 阶段团队规模小、迭代速度快、运维能力有限，单体架构是最务实的选择。但单体不意味着「大泥球」——通过模块化设计（Modular Monolith），在单体内部保持模块的独立性，为 V3 微服务拆分预留边界。

### 5.1.3 为什么选择前后端分离

1. **UI 可替换**：后端 API 稳定，前端可以整体替换（如未来迁移到移动端）
2. **开发并行**：前后端可以并行开发，通过 API 契约解耦
3. **技术独立**：前后端可以选择各自最适合的技术栈
4. **部署灵活**：前端可以部署到 CDN，后端部署到应用服务器

---

## 5.2 前端架构

### 5.2.1 技术栈

| 技术 | 版本建议 | 用途 |
|------|----------|------|
| React | 18+ | UI 框架 |
| TypeScript | 5+ | 类型安全 |
| Vite | 5+ | 构建工具 |
| TailwindCSS | 3+ | 样式方案 |
| React Router | 6+ | 路由管理 |
| Zustand | 4+ | 状态管理 |
| Socket.IO Client 或原生 WebSocket | - | 实时通信 |
| Axios | 1+ | HTTP 客户端 |

> 选择原因：

- **React**：生态成熟，组件化开发，适合复杂的交互界面（数独棋盘）
- **TypeScript**：类型安全减少运行时错误，提升团队协作效率
- **Vite**：开发体验优秀，热更新速度快
- **TailwindCSS**：原子化 CSS，避免样式冲突，定制方便
- **React Router**：React 生态标准路由方案
- **Zustand**：比 Redux 更轻量的状态管理方案，适合 MVP。如果未来状态复杂度增加，可以迁移到 Redux Toolkit
- **原生 WebSocket**：MVP 阶段使用原生 WebSocket，Spring 的 STOMP 协议有对应的 JS 客户端（@stomp/stompjs）。不选 Socket.IO 是因为后端使用 Spring WebSocket，不需要 Socket.IO 的额外协议

### 5.2.2 前端分层架构

```
┌──────────────────────────────────────────────────┐
│                    页面层 (Pages)                 │
│  路由对应的页面组件，组合 Feature 组件构成完整视图 │
├──────────────────────────────────────────────────┤
│                  功能层 (Features)                │
│  按业务功能组织的组件集合，包含业务逻辑和状态     │
│  ├── admin/     管理员功能                       │
│  ├── judge/     裁判功能                         │
│  └── player/    选手功能                         │
├──────────────────────────────────────────────────┤
│                  组件层 (Components)              │
│  可复用的 UI 组件，不包含业务逻辑                │
│  ├── SudokuGrid    数独棋盘组件                  │
│  ├── Timer         计时器组件                    │
│  ├── ScoreBoard    计分板组件                    │
│  └── ...                                        │
├──────────────────────────────────────────────────┤
│                  服务层 (Services)                │
│  API 调用、WebSocket 通信、状态管理               │
│  ├── api/          REST API 客户端               │
│  ├── ws/           WebSocket 客户端              │
│  └── stores/       Zustand 状态管理              │
├──────────────────────────────────────────────────┤
│                  工具层 (Utils)                   │
│  纯函数工具，无副作用                            │
│  ├── sudoku.ts     数独相关工具函数              │
│  ├── format.ts     格式化工具                    │
│  └── types.ts      全局类型定义                  │
└──────────────────────────────────────────────────┘
```

### 5.2.3 前端目录结构

```
sudoku-arena-ui/
├── public/
│   └── favicon.ico
├── src/
│   ├── api/                    # REST API 客户端
│   │   ├── client.ts           # Axios 实例配置
│   │   ├── auth.ts             # 认证相关 API
│   │   ├── tournament.ts       # 比赛管理 API
│   │   ├── puzzle.ts           # 题目管理 API
│   │   ├── team.ts             # 队伍管理 API
│   │   └── score.ts            # 计分相关 API
│   ├── ws/                     # WebSocket 通信
│   │   ├── client.ts           # WebSocket 连接管理
│   │   ├── events.ts           # 事件类型定义
│   │   └── handlers.ts         # 事件处理器
│   ├── stores/                 # Zustand 状态管理
│   │   ├── auth.ts             # 认证状态
│   │   ├── tournament.ts       # 比赛状态
│   │   ├── game.ts             # 比赛进行中的状态
│   │   └── score.ts            # 分数状态
│   ├── components/             # 可复用 UI 组件
│   │   ├── ui/                 # 基础 UI 组件（Button, Input, Modal 等）
│   │   ├── SudokuGrid.tsx      # 数独棋盘组件
│   │   ├── Timer.tsx           # 计时器组件
│   │   ├── ScoreBoard.tsx      # 计分板组件
│   │   ├── PlayerList.tsx      # 选手列表组件
│   │   └── RoundIndicator.tsx  # 轮次指示器
│   ├── features/               # 按角色组织的功能模块
│   │   ├── admin/              # 管理员功能
│   │   │   ├── pages/          # 管理员页面
│   │   │   ├── components/     # 管理员专用组件
│   │   │   └── hooks/          # 管理员专用 hooks
│   │   ├── judge/              # 裁判功能
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   └── player/             # 选手功能
│   │       ├── pages/
│   │       ├── components/
│   │       └── hooks/
│   ├── pages/                  # 通用页面
│   │   ├── LoginPage.tsx       # 登录页
│   │   └── NotFoundPage.tsx    # 404 页面
│   ├── hooks/                  # 通用 hooks
│   │   ├── useAuth.ts          # 认证 hook
│   │   ├── useWebSocket.ts     # WebSocket hook
│   │   └── useTimer.ts         # 计时器 hook
│   ├── utils/                  # 工具函数
│   │   ├── sudoku.ts           # 数独相关工具
│   │   ├── format.ts           # 格式化
│   │   └── constants.ts        # 常量
│   ├── types/                  # 类型定义
│   │   ├── api.ts              # API 响应类型
│   │   ├── ws.ts               # WebSocket 事件类型
│   │   ├── sudoku.ts           # 数独相关类型
│   │   └── models.ts           # 领域模型类型
│   ├── router/                 # 路由配置
│   │   ├── index.tsx           # 路由定义
│   │   └── guards.tsx          # 路由守卫（权限控制）
│   ├── App.tsx                 # 应用入口
│   └── main.tsx                # 渲染入口
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

> 设计原因：目录结构按「关注点分离」组织。`features/` 按角色划分，避免不同角色的代码混杂；`components/` 存放可复用组件，可以被不同 feature 引用；`api/` 和 `ws/` 封装通信逻辑，组件不直接调用 HTTP 或 WebSocket。这种结构使每个角色的功能可以独立开发和维护。

---

## 5.3 后端架构

### 5.3.1 技术栈

| 技术 | 用途 |
|------|------|
| Spring Boot 3.x | 应用框架 |
| Spring Security | 认证与授权 |
| Spring WebSocket (STOMP) | 实时通信 |
| Spring Data JPA | 数据持久化 |
| PostgreSQL | 关系数据库 |
| JWT (jjwt) | Token 生成与验证 |
| Lombok | 减少样板代码 |
| Flyway | 数据库版本管理 |

> 选择原因：

- **Spring Boot**：Java 生态最成熟的 Web 框架，开箱即用
- **Spring Security**：与 Spring Boot 无缝集成，JWT 认证方案成熟
- **Spring WebSocket + STOMP**：Spring 原生支持，与 Spring Security 集成方便，支持订阅/发布模式
- **Spring Data JPA**：简化数据访问层开发，MVP 阶段不需要复杂查询
- **PostgreSQL**：功能最完善的开源关系数据库，JSON 支持好
- **Flyway**：数据库版本管理，团队协作时避免数据库结构不一致

### 5.3.2 后端分层架构

```
┌──────────────────────────────────────────────────────┐
│                   Controller 层                      │
│  接收 HTTP 请求和 WebSocket 消息，参数校验，返回响应  │
│  不包含业务逻辑                                      │
├──────────────────────────────────────────────────────┤
│                    Service 层                        │
│  业务逻辑的核心实现，协调各个组件完成业务功能         │
│  事务管理在此层                                      │
├──────────────────────────────────────────────────────┤
│                   Repository 层                      │
│  数据访问，封装 JPA 操作                             │
│  仅包含数据查询逻辑，不包含业务逻辑                   │
├──────────────────────────────────────────────────────┤
│                     Model 层                         │
│  Entity（数据库映射）+ DTO（数据传输）+ 枚举          │
└──────────────────────────────────────────────────────┘
```

### 5.3.3 后端模块划分

```
com.sudoku.arena/
├── config/                     # 配置类
│   ├── SecurityConfig          # Spring Security 配置
│   ├── WebSocketConfig         # WebSocket 配置
│   └── CorsConfig              # 跨域配置
├── security/                   # 认证与授权
│   ├── JwtTokenProvider        # Token 生成与验证
│   ├── JwtAuthenticationFilter # Token 过滤器
│   └── UserPrincipal           # 当前用户信息
├── user/                       # 用户管理模块
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   └── entity/
├── tournament/                 # 比赛管理模块
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   └── entity/
├── puzzle/                     # 题库管理模块
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   └── entity/
├── team/                       # 队伍管理模块
│   ├── controller/
│   ├── service/
│   ├── repository/
│   ├── dto/
│   └── entity/
├── engine/                     # 比赛引擎模块
│   ├── controller/             # 比赛控制 API（开始/暂停/结束）
│   ├── service/
│   │   ├── GameEngine          # 比赛引擎主服务
│   │   ├── Round1Engine        # 第一轮引擎
│   │   ├── Round2Engine        # 第二轮引擎
│   │   └── Round3Engine        # 第三轮引擎
│   ├── scheduler/              # 定时任务（轮转调度、倒计时）
│   └── dto/
├── room/                       # 房间管理模块
│   ├── service/
│   └── dto/
├── scoring/                    # 计分系统模块
│   ├── service/
│   │   ├── ScoreService        # 计分服务
│   │   └── AnswerValidator     # 答案验证器
│   └── dto/
├── ws/                         # WebSocket 通信模块
│   ├── WebSocketHandler        # WebSocket 消息处理
│   ├── EventPublisher          # 事件发布
│   └── dto/                    # 事件消息 DTO
└── common/                     # 公共模块
    ├── exception/              # 异常定义
    │   ├── GlobalExceptionHandler  # 全局异常处理
    │   └── BusinessException    # 业务异常
    ├── util/                   # 工具类
    └── constant/               # 常量
```

> 设计原因：后端按业务模块组织（Package by Feature），而非按技术层组织（Package by Layer）。每个模块包含自己的 Controller、Service、Repository、DTO 和 Entity，模块内高内聚，模块间通过 Service 接口通信。这是 Modular Monolith 的核心设计——模块边界清晰，未来拆分为微服务时，每个模块就是一个服务。

### 5.3.4 模块依赖关系

```
                    ┌─────────┐
                    │  config  │
                    └────┬─────┘
                         │ 配置
          ┌──────────────┼──────────────┐
          │              │              │
    ┌─────┴─────┐  ┌────┴─────┐  ┌─────┴─────┐
    │ security  │  │   ws     │  │  common   │
    └─────┬─────┘  └────┬─────┘  └───────────┘
          │              │
          ▼              ▼
    ┌───────────┐  ┌──────────┐
    │   user    │  │ scoring  │
    └─────┬─────┘  └────┬─────┘
          │              │
          ▼              ▼
    ┌───────────┐  ┌──────────┐
    │  puzzle   │  │  room    │
    └─────┬─────┘  └────┬─────┘
          │              │
          ▼              ▼
    ┌───────────┐  ┌──────────┐
    │   team    │  │tournament│
    └─────┬─────┘  └────┬─────┘
          │              │
          └──────┬───────┘
                 ▼
          ┌────────────┐
          │   engine   │  ← 依赖所有业务模块，但只通过 Service 接口
          └────────────┘
```

依赖规则：

1. engine 可以依赖其他模块的 Service 接口
2. 其他模块之间不能互相依赖（如 user 不依赖 puzzle）
3. common 被所有模块依赖
4. 依赖方向必须是单向的，不能循环

> 设计原因：engine 作为协调者，是唯一允许依赖多个模块的服务。这种「星形依赖」结构避免了循环依赖，同时保持了模块的独立性。如果未来拆分微服务，engine 可以作为编排服务，其他模块作为独立服务。

---

## 5.4 数据库设计

### 5.4.1 数据库选型

选择 PostgreSQL，原因：

1. 功能完善：支持 JSON 类型（未来存储题目扩展信息）、全文搜索、窗口函数
2. 可靠性高：ACID 事务、WAL 日志、MVCC 并发控制
3. 扩展性好：支持读写分离、分区表（V2 功能）
4. 社区活跃：文档完善，问题容易解决
5. 免费开源：无许可成本

### 5.4.2 为什么不用 Redis

MVP 阶段不需要 Redis：

1. 单服务器部署，不需要分布式缓存
2. 比赛状态可以直接在 JVM 内存中管理
3. 数据库连接数有限（50 人并发），PostgreSQL 完全胜任
4. 引入 Redis 增加运维复杂度，与 MVP 原则冲突

V2 引入 Redis 的时机：

1. 需要水平扩展（多台应用服务器）
2. 需要分布式 Session
3. 比赛状态需要跨进程共享
4. 实时推送频率增加，需要 Pub/Sub

> 架构预留：实时状态管理通过抽象接口（如 `StateService`），V2 实现 Redis 版本替换内存版本。

### 5.4.3 数据库版本管理

使用 Flyway 管理 Schema 版本：

```
db/migration/
├── V1__create_user_tables.sql
├── V2__create_tournament_tables.sql
├── V3__create_puzzle_tables.sql
├── V4__create_team_tables.sql
├── V5__create_score_tables.sql
└── V6__create_game_state_tables.sql
```

> 设计原因：Flyway 是最简单的数据库版本管理工具，Spring Boot 原生支持。每个迁移脚本对应一个版本，团队协作时避免数据库结构不一致。

---

## 5.5 WebSocket 设计

### 5.5.1 协议选择

使用 Spring WebSocket + STOMP 协议。

> 选择原因：

1. **STOMP**：Simple Text Oriented Messaging Protocol，提供订阅/发布语义，比原生 WebSocket 更适合「通道订阅」场景
2. **Spring 集成**：Spring 对 STOMP 有原生支持，包括认证、拦截器、消息转换等
3. **简化开发**：STOMP 提供了标准化的消息格式（destination、headers、body），不需要自定义协议

### 5.5.2 WebSocket 架构

```
客户端                    服务端
  │                        │
  │  CONNECT (token)       │
  │ ───────────────────► │  验证 Token，建立连接
  │                        │
  │  SUBSCRIBE /topic/... │
  │ ───────────────────► │  订阅比赛通道
  │                        │
  │  SEND /app/...        │
  │ ───────────────────► │  发送操作（填写格子、提交答案）
  │                        │
  │  MESSAGE /topic/...   │
  │ ◄─────────────────── │  接收推送（倒计时、分数等）
  │                        │
  │  HEARTBEAT            │
  │ ◄──────────────────► │  心跳保活
```

### 5.5.3 通道设计

| 通道 | 类型 | 订阅者 | 用途 |
|------|------|--------|------|
| /topic/tournament/{id} | 广播 | 该比赛所有用户 | 比赛级事件（开始、结束、轮次变更） |
| /topic/tournament/{id}/round | 广播 | 该比赛所有用户 | 轮次级事件（倒计时、暂停、恢复） |
| /user/queue/game | 定向 | 特定用户 | 个人事件（题目分配、答案反馈、冲突通知） |
| /topic/tournament/{id}/team/{teamId} | 组播 | 特定队伍 | 队伍级事件（第三轮棋盘同步、队伍分数） |

> 设计原因：按消息的可见范围设计不同通道。广播通道用于全局事件，定向通道用于个人事件，组播通道用于队伍内部事件。这种分层减少了不必要的消息推送，降低了客户端的消息处理负担。

---

## 5.6 模块划分总结

### 5.6.1 模块职责与边界

| 模块 | 包路径 | 核心类 | 对外接口 | 依赖 |
|------|--------|--------|----------|------|
| 用户管理 | user | UserService | UserService | security, common |
| 比赛管理 | tournament | TournamentService | TournamentService | user, puzzle, team |
| 题库管理 | puzzle | PuzzleService | PuzzleService | common |
| 队伍管理 | team | TeamService | TeamService | user, common |
| 比赛引擎 | engine | GameEngine, RoundEngine | GameEngineService | tournament, puzzle, team, room, scoring, ws |
| 房间管理 | room | RoomService | RoomService | user, common |
| 计分系统 | scoring | ScoreService, AnswerValidator | ScoreService | puzzle, common |
| 实时同步 | ws | EventPublisher | EventPublisher | common |

### 5.6.2 模块间通信方式

1. **同步调用**：模块间通过 Service 接口直接调用（如 engine 调用 scoringService）
2. **异步事件**：通过 EventPublisher 发布事件，订阅者处理（如答题完成后发布分数更新事件）
3. **WebSocket 推送**：通过 EventPublisher 向客户端推送实时消息

> 设计原因：MVP 阶段同步调用最简单。异步事件用于解耦「答题」和「分数更新」等场景，避免循环调用。V2 引入消息队列后，异步事件可以替换为消息队列实现，业务代码不需要修改。

---

## 5.7 为什么这样设计

### 5.7.1 关键设计决策总结

| 决策 | 选择 | 备选方案 | 选择原因 |
|------|------|----------|----------|
| 架构风格 | Modular Monolith | 微服务 | MVP 阶段效率优先，但模块化预留拆分边界 |
| 前端框架 | React | Vue, Angular | 生态最成熟，数独棋盘需要复杂交互 |
| 状态管理 | Zustand | Redux, Context | 轻量简单，MVP 够用 |
| 后端框架 | Spring Boot | Express, Django | Java 生态成熟，团队技术栈匹配 |
| 实时通信 | STOMP over WebSocket | Socket.IO, SSE | Spring 原生支持，订阅/发布语义清晰 |
| 数据库 | PostgreSQL | MySQL, MongoDB | 功能最完善，JSON 支持好 |
| 认证 | JWT | Session | 前后端分离更适合 Token 认证 |
| CSS 方案 | TailwindCSS | CSS Modules, Styled Components | 原子化样式，开发速度快，定制方便 |
| 数据库迁移 | Flyway | Liquibase | 更简单，SQL 原生，Spring Boot 原生支持 |

### 5.7.2 架构风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| WebSocket 断线 | 选手失去实时更新 | 客户端自动重连 + 重连后状态同步 |
| 服务器单点故障 | 比赛中断 | V2 引入 Redis + 多实例，MVP 接受风险 |
| 第二轮轮转逻辑复杂 | 开发周期延长 | 提前编写详细单元测试，先在模拟环境验证 |
| 第三轮并发填写冲突 | 用户体验差 | 先到先得策略 + 快速冲突反馈 |
| 内存中状态丢失 | 服务器重启后比赛状态丢失 | 关键状态实时持久化到数据库 |
