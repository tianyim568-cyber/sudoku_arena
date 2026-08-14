# 第七部分：REST API 建议

> ⚠️ **历史文档说明**：本文档中描述的 `/api/tournaments` 系列路径已在「tournament → competition」迁移中全部更名为 `/api/competitions`。当前权威的接口列表请参考 `DEVELOPMENT_PLAN.md` §14。本文件保留作为历史参考与设计原则说明，但其中的具体路径不再有效。

## 7.1 API 设计原则

1. **RESTful 风格**：资源导向，使用 HTTP 方法语义（GET/POST/PUT/DELETE）
2. **统一响应格式**：所有 API 返回统一的 JSON 结构
3. **JWT 认证**：除登录接口外，所有 API 需携带 Authorization Header
4. **角色权限**：不同角色可访问的 API 不同，后端校验
5. **分页支持**：列表接口支持分页
6. **错误码统一**：使用标准 HTTP 状态码 + 业务错误码

### 统一响应格式

```
成功响应：
{
  "code": 200,
  "message": "success",
  "data": { ... }
}

错误响应：
{
  "code": 40001,
  "message": "用户名已存在",
  "data": null
}

分页响应：
{
  "code": 200,
  "message": "success",
  "data": {
    "content": [ ... ],
    "totalElements": 100,
    "totalPages": 10,
    "pageNumber": 0,
    "pageSize": 10
  }
}
```

> 设计原因：统一响应格式使前端可以统一处理响应逻辑，不需要为每个 API 写不同的解析逻辑。错误码 + 错误消息的组合既有机器可读性，又有人类可读性。

---

## 7.2 认证相关 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| AUTH-01 | POST | /api/auth/login | 公开 | 用户登录 |
| AUTH-02 | POST | /api/auth/logout | 已认证 | 用户登出 |
| AUTH-03 | GET | /api/auth/me | 已认证 | 获取当前用户信息 |

### AUTH-01 用户登录

- 请求体：`{ "username": "string", "password": "string" }`
- 响应体：`{ "token": "string", "user": { "id", "username", "role", "displayName" } }`
- 错误码：
  - 40001：用户名或密码错误
  - 40002：账号已被禁用

### AUTH-03 获取当前用户信息

- 请求：无（从 Token 中解析）
- 响应体：`{ "id", "username", "role", "displayName" }`
- 用途：前端刷新页面后恢复用户状态

---

## 7.3 用户管理 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| USER-01 | POST | /api/users | 管理员 | 创建用户 |
| USER-02 | GET | /api/users | 管理员 | 获取用户列表 |
| USER-03 | GET | /api/users/{id} | 管理员 | 获取用户详情 |

### USER-01 创建用户

- 请求体：`{ "username", "password", "role", "displayName" }`
- 响应体：`{ "id", "username", "role", "displayName" }`
- 错误码：
  - 40003：用户名已存在
  - 40004：角色值无效

> 设计原因：MVP 阶段用户管理仅支持创建和查看，不支持修改和删除。管理员创建账号后通知选手使用，这是最简单的用户生命周期管理。

---

## 7.4 比赛管理 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| TM-01 | POST | /api/tournaments | 管理员 | 创建比赛 |
| TM-02 | GET | /api/tournaments | 管理员/裁判 | 获取比赛列表 |
| TM-03 | GET | /api/tournaments/{id} | 管理员/裁判 | 获取比赛详情 |
| TM-04 | PUT | /api/tournaments/{id} | 管理员 | 更新比赛信息（仅赛前） |
| TM-05 | GET | /api/tournaments/{id}/status | 已认证 | 获取比赛状态 |

### TM-01 创建比赛

- 请求体：`{ "name", "description", "scheduledTime" }`
- 响应体：`{ "id", "name", "description", "status", "scheduledTime", "createdAt" }`

### TM-03 获取比赛详情

- 响应体包含：基本信息、轮次列表、队伍列表、裁判列表、题目统计

> 设计原因：比赛详情接口聚合了多个维度的信息，前端在比赛详情页一次请求获取所有数据，避免多次请求。如果后续数据量增大（如题目很多），可以拆分为子资源接口。

---

## 7.5 轮次管理 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| ROUND-01 | POST | /api/tournaments/{id}/rounds | 管理员 | 创建轮次 |
| ROUND-02 | GET | /api/tournaments/{id}/rounds | 管理员/裁判 | 获取轮次列表 |
| ROUND-03 | GET | /api/rounds/{id} | 管理员/裁判 | 获取轮次详情 |
| ROUND-04 | PUT | /api/rounds/{id} | 管理员 | 更新轮次配置（仅赛前） |

### ROUND-01 创建轮次

- 请求体：`{ "name", "roundType", "durationSeconds" }`
- 响应体：`{ "id", "roundNumber", "name", "roundType", "durationSeconds", "status" }`
- 错误码：
  - 40010：该比赛轮次数量已达上限（3个）
  - 40011：轮次类型重复

---

## 7.6 题目管理 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| PUZZLE-01 | POST | /api/rounds/{id}/puzzles/import | 管理员 | 批量导入题目 |
| PUZZLE-02 | GET | /api/rounds/{id}/puzzles | 管理员 | 获取轮次题目列表 |
| PUZZLE-03 | GET | /api/puzzles/{id} | 管理员 | 获取题目详情 |
| PUZZLE-04 | DELETE | /api/puzzles/{id} | 管理员 | 删除题目（仅赛前） |

### PUZZLE-01 批量导入题目

- 请求体：`{ "puzzles": [{ "type", "order", "initialGrid", "solution", "points", "letter" }] }`
- 响应体：`{ "successCount", "failCount", "errors": [{ "index", "message" }] }`
- 错误码：
  - 40020：题目数据校验失败（附详细错误列表）
  - 40021：题目数量不符合要求
  - 40022：JOC 题目缺少关联字母

> 设计原因：题目导入是最复杂的 API 之一，需要详尽的校验和清晰的错误反馈。failCount 和 errors 数组告诉管理员哪些题目导入失败及原因，方便修正后重新导入。

---

## 7.7 队伍管理 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| TEAM-01 | POST | /api/tournaments/{id}/teams | 管理员 | 创建队伍 |
| TEAM-02 | GET | /api/tournaments/{id}/teams | 管理员/裁判 | 获取队伍列表 |
| TEAM-03 | GET | /api/teams/{id} | 管理员/裁判 | 获取队伍详情 |
| TEAM-04 | POST | /api/teams/{id}/members | 管理员 | 添加队伍成员 |
| TEAM-05 | DELETE | /api/teams/{id}/members/{playerId} | 管理员 | 移除队伍成员 |

### TEAM-04 添加队伍成员

- 请求体：`{ "playerId", "position" }`
- 响应体：`{ "id", "teamId", "playerId", "position", "joinedAt" }`
- 错误码：
  - 40030：选手已分配到其他队伍
  - 40031：该位置已被占用

---

## 7.8 比赛控制 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| GAME-01 | POST | /api/tournaments/{id}/start | 裁判/管理员 | 开始比赛 |
| GAME-02 | POST | /api/tournaments/{id}/rounds/{roundId}/start | 裁判/管理员 | 开始轮次 |
| GAME-03 | POST | /api/tournaments/{id}/pause | 裁判 | 暂停比赛 |
| GAME-04 | POST | /api/tournaments/{id}/resume | 裁判 | 恢复比赛 |
| GAME-05 | POST | /api/tournaments/{id}/rounds/{roundId}/end | 裁判/管理员 | 结束轮次 |
| GAME-06 | POST | /api/tournaments/{id}/end | 裁判/管理员 | 结束比赛 |

### GAME-01 开始比赛

- 前置条件：比赛状态为 READY（配置完成）
- 后置效果：比赛状态变更为 IN_PROGRESS
- 响应体：`{ "tournamentId", "status", "startedAt" }`
- 错误码：
  - 40040：比赛配置不完整（缺少轮次/题目/队伍）
  - 40041：比赛状态不允许开始

### GAME-02 开始轮次

- 前置条件：比赛进行中，当前轮次未开始
- 后置效果：轮次状态变更为 IN_PROGRESS，启动计时，推送事件
- 响应体：`{ "roundId", "status", "startedAt", "durationSeconds" }`
- 特殊逻辑：
  - 第二轮：检查每队是否恰好 4 人
  - 第二轮：分配初始题目给各队员
  - 第三轮：为每队创建共享棋盘

> 设计原因：比赛控制 API 全部使用 POST 方法，因为这些都是「命令」而非「查询」。虽然某些操作（如暂停）可以用 PUT，但 POST 语义更明确——这些操作会触发服务器端的复杂流程（启动计时、推送事件等），不是简单的状态更新。

---

## 7.9 答案提交 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| SUBMIT-01 | POST | /api/submissions | 选手 | 提交答案 |

### SUBMIT-01 提交答案

- 请求体：
  - JOC 类型：`{ "roundId", "puzzleId", "type": "SINGLE_CELL", "row", "col", "value" }`
  - 完整棋盘：`{ "roundId", "puzzleId", "type": "FULL_GRID", "grid": [[...]] }`
- 响应体：`{ "submissionId", "isCorrect", "pointsEarned", "letter" (JOC) }`
- 错误码：
  - 40050：比赛未进行中
  - 40051：该题目已提交
  - 40052：该题目未分配给当前选手
  - 40053：提交内容格式错误

> 设计原因：答案提交同时支持 REST API 和 WebSocket 两种方式。REST API 作为主要提交通道（更可靠），WebSocket 作为实时反馈通道（更快）。选手通过 REST API 提交答案，服务器通过 WebSocket 推送判定结果。这种「双通道」设计确保提交的可靠性（REST 有重试机制）和反馈的实时性（WebSocket 即时推送）。

---

## 7.10 分数查询 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| SCORE-01 | GET | /api/tournaments/{id}/scores/my | 选手 | 获取自己的分数 |
| SCORE-02 | GET | /api/tournaments/{id}/scores/teams | 已认证 | 获取队伍分数排名 |
| SCORE-03 | GET | /api/tournaments/{id}/rounds/{roundId}/scores | 裁判/管理员 | 获取轮次详细分数 |

### SCORE-01 获取自己的分数

- 响应体：
  ```
  {
    "playerScores": [
      { "roundId", "roundName", "totalPoints", "submissions": [...] }
    ],
    "teamScores": [
      { "roundId", "roundName", "teamName", "totalPoints" }
    ]
  }
  ```

---

## 7.11 房间状态 API

| 编号 | 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|------|
| ROOM-01 | GET | /api/tournaments/{id}/room/status | 裁判/管理员 | 获取房间状态 |
| ROOM-02 | GET | /api/tournaments/{id}/room/players | 裁判/管理员 | 获取房间内选手列表及在线状态 |

### ROOM-01 获取房间状态

- 响应体：
  ```
  {
    "tournamentId",
    "status",
    "currentRound": { "roundId", "roundName", "status", "remainingSeconds" },
    "teams": [
      { "teamId", "teamName", "players": [{ "playerId", "displayName", "online", "currentPuzzleId" }] }
    ]
  }
  ```

> 设计原因：房间状态 API 是裁判监控比赛的核心接口。它聚合了比赛状态、当前轮次、各队选手状态等信息，裁判控制台定时轮询此接口刷新状态（或通过 WebSocket 接收增量更新）。

---

## 7.12 API 错误码汇总

| 范围 | 模块 | 示例 |
|------|------|------|
| 40001-40009 | 认证 | 40001 用户名或密码错误 |
| 40010-40019 | 轮次 | 40010 轮次数量超限 |
| 40020-40029 | 题目 | 40020 题目数据校验失败 |
| 40030-40039 | 队伍 | 40030 选手已分配 |
| 40040-40049 | 比赛控制 | 40040 比赛配置不完整 |
| 40050-40059 | 提交 | 40050 比赛未进行中 |
| 50001-50099 | 系统错误 | 50001 服务器内部错误 |

> 设计原因：错误码按模块分段，避免冲突，方便前端按范围处理不同模块的错误。400xx 是业务错误（客户端可处理），500xx 是系统错误（客户端只能提示重试）。
