# 第八部分：WebSocket 事件设计

## 8.1 事件设计原则

1. **服务器权威**：所有事件的方向以服务器推送为主，客户端发送的操作请求仅作为「指令」，不作为「状态变更」
2. **事件幂等**：同一事件多次推送不应导致状态异常
3. **时间戳包含**：所有事件携带服务器时间戳，客户端据此判断事件顺序
4. **类型标识**：每个事件有明确的 type 字段，客户端据此路由到对应处理器

### 统一事件格式

```
{
  "type": "事件类型",
  "timestamp": "2026-07-10T14:30:00.000Z",
  "tournamentId": 1,
  "payload": { ... }
}
```

> 设计原因：统一事件格式使前端可以用一个统一的事件分发器处理所有 WebSocket 消息，而不是为每种事件写不同的监听器。timestamp 由服务器生成，客户端不依赖本地时间。

---

## 8.2 客户端发送事件

客户端通过 STOMP 的 SEND 命令发送事件到服务器的 `/app/` 前缀路径。

### 8.2.1 事件列表

| 编号 | 事件类型 | STOMP Destination | 发送者 | 说明 |
|------|----------|-------------------|--------|------|
| CS-01 | CELL_FILL | /app/game/cell-fill | 选手 | 填写棋盘格子（第三轮） |
| CS-02 | ANSWER_SUBMIT | /app/game/answer-submit | 选手 | 提交答案 |
| CS-03 | HEARTBEAT | /app/heartbeat | 全部 | 心跳保活 |
| CS-04 | JOIN_ROOM | /app/room/join | 选手 | 进入比赛房间 |
| CS-05 | LEAVE_ROOM | /app/room/leave | 选手 | 离开比赛房间 |

### 8.2.2 事件详细说明

**CS-01 CELL_FILL（填写格子）**

- 触发场景：第三轮齐心协力中，选手在共享棋盘上填写一个格子
- 事件体：
  ```
  {
    "type": "CELL_FILL",
    "tournamentId": 1,
    "roundId": 3,
    "puzzleId": 10,
    "payload": {
      "row": 3,
      "col": 5,
      "value": 7
    }
  }
  ```
- 服务器处理：
  1. 验证比赛进行中
  2. 验证该格子是否已被其他选手占用
  3. 如果格子为空或已被当前选手占用：接受填写，更新 current_grid，广播给全队
  4. 如果格子已被其他选手占用：拒绝，发送 CELL_CONFLICT 事件给当前选手

> 设计原因：第三轮的格子填写是高频操作，通过 WebSocket 而非 REST API 提交，减少 HTTP 请求开销。服务器作为唯一仲裁者，先到先得。

**CS-02 ANSWER_SUBMIT（提交答案）**

- 触发场景：选手完成一道题后提交
- 事件体（JOC 类型）：
  ```
  {
    "type": "ANSWER_SUBMIT",
    "tournamentId": 1,
    "roundId": 1,
    "puzzleId": 5,
    "payload": {
      "submissionType": "SINGLE_CELL",
      "row": 3,
      "col": 5,
      "value": 7
    }
  }
  ```
- 事件体（完整棋盘）：
  ```
  {
    "type": "ANSWER_SUBMIT",
    "tournamentId": 1,
    "roundId": 2,
    "puzzleId": 12,
    "payload": {
      "submissionType": "FULL_GRID",
      "grid": [[5,3,4,6,7,8,9,1,2], ...]
    }
  }
  ```
- 服务器处理：
  1. 验证比赛进行中
  2. 验证该题目已分配给当前选手
  3. 验证该题目未提交过
  4. 判定答案正确性
  5. 计算分数
  6. 发送 ANSWER_RESULT 事件给选手
  7. 发送 SCORE_UPDATE 事件给相关方
  8. 第二轮：如果正确，从题池分配新题，发送 PUZZLE_ASSIGN 事件

> 设计原因：提交答案也可以通过 REST API（SUBMIT-01）进行。两种方式都支持，WebSocket 方式响应更快，REST API 方式更可靠。实际实现中建议两者都支持，客户端优先使用 WebSocket，WebSocket 断线时回退到 REST API。

**CS-03 HEARTBEAT（心跳）**

- 触发场景：客户端每 30 秒发送一次
- 事件体：
  ```
  {
    "type": "HEARTBEAT",
    "tournamentId": 1
  }
  ```
- 服务器处理：更新该客户端的最后活跃时间，不做其他操作

**CS-04 JOIN_ROOM（进入房间）**

- 触发场景：选手进入比赛房间
- 事件体：
  ```
  {
    "type": "JOIN_ROOM",
    "tournamentId": 1
  }
  ```
- 服务器处理：
  1. 标记选手为「在线」
  2. 广播 PLAYER_STATUS_CHANGE 事件
  3. 推送当前比赛状态给该选手

**CS-05 LEAVE_ROOM（离开房间）**

- 触发场景：选手退出比赛房间（仅比赛未开始时允许）
- 事件体：
  ```
  {
    "type": "LEAVE_ROOM",
    "tournamentId": 1
  }
  ```
- 服务器处理：
  1. 标记选手为「离线」
  2. 广播 PLAYER_STATUS_CHANGE 事件

---

## 8.3 服务器发送事件

服务器通过 STOMP 的 MESSAGE 命令推送事件到客户端订阅的通道。

### 8.3.1 广播事件（/topic/tournament/{id}）

向比赛中所有用户推送的全局事件。

| 编号 | 事件类型 | 说明 | 触发时机 |
|------|----------|------|----------|
| SS-01 | TOURNAMENT_STARTED | 比赛开始 | 裁判触发开始比赛 |
| SS-02 | TOURNAMENT_PAUSED | 比赛暂停 | 裁判触发暂停 |
| SS-03 | TOURNAMENT_RESUMED | 比赛恢复 | 裁判触发恢复 |
| SS-04 | TOURNAMENT_FINISHED | 比赛结束 | 所有轮次完成或裁判结束 |
| SS-05 | ROUND_STARTED | 轮次开始 | 裁判触发开始轮次 |
| SS-06 | ROUND_FINISHED | 轮次结束 | 计时结束或裁判结束轮次 |
| SS-07 | TIMER_TICK | 倒计时更新 | 每秒推送一次 |
| SS-08 | ROUND_PAUSED | 轮次暂停 | 比赛暂停时 |
| SS-09 | ROUND_RESUMED | 轮次恢复 | 比赛恢复时 |

### 8.3.2 组播事件（/topic/tournament/{id}/team/{teamId}）

向特定队伍的所有成员推送的事件。

| 编号 | 事件类型 | 说明 | 触发时机 |
|------|----------|------|----------|
| SS-10 | SCORE_UPDATE | 分数更新 | 队伍中任何选手得分 |
| SS-11 | CELL_BROADCAST | 格子填写广播 | 第三轮队员填写格子 |
| SS-12 | TEAM_PUZZLE_COMPLETED | 队伍完成一道题 | 第三轮正确提交后进入下一题 |
| SS-13 | TEAM_PUZZLE_NEXT | 分配下一题 | 第三轮完成一题后 |

### 8.3.3 定向事件（/user/queue/game）

向特定用户推送的个人事件。

| 编号 | 事件类型 | 说明 | 触发时机 |
|------|----------|------|----------|
| SS-14 | PUZZLE_ASSIGN | 题目分配 | 轮次开始或第二轮分配新题 |
| SS-15 | ANSWER_RESULT | 答案判定结果 | 提交答案后 |
| SS-16 | CELL_CONFLICT | 格子冲突 | 第三轮填写已被占用的格子 |
| SS-17 | PUZZLE_ROTATE | 题目轮转 | 第二轮每分钟轮转 |
| SS-18 | PLAYER_STATUS_CHANGE | 选手状态变更 | 其他选手上线/下线 |
| SS-19 | LETTER_REVEAL | 字母揭示 | 第一轮正确回答 JOC 题目 |
| SS-20 | GAME_STATE_SYNC | 比赛状态同步 | 选手重连后 |

### 8.3.4 事件详细说明

**SS-01 TOURNAMENT_STARTED（比赛开始）**

```
{
  "type": "TOURNAMENT_STARTED",
  "timestamp": "2026-07-10T14:00:00.000Z",
  "tournamentId": 1,
  "payload": {
    "tournamentName": "2026 全国数独锦标赛",
    "totalRounds": 3,
    "teams": [
      { "teamId": 1, "teamName": "Alpha队", "playerCount": 4 }
    ]
  }
}
```

> 用途：通知所有选手比赛已开始，显示比赛信息和队伍列表。

**SS-05 ROUND_STARTED（轮次开始）**

```
{
  "type": "ROUND_STARTED",
  "timestamp": "2026-07-10T14:05:00.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "roundNumber": 1,
    "roundName": "九九归一",
    "roundType": "ROUND1_NINE_ONE",
    "durationSeconds": 1200,
    "totalPuzzles": 10
  }
}
```

> 用途：通知选手当前轮次已开始，显示轮次名称和规则。随后服务器会通过 PUZZLE_ASSIGN 事件分配具体题目。

**SS-07 TIMER_TICK（倒计时更新）**

```
{
  "type": "TIMER_TICK",
  "timestamp": "2026-07-10T14:05:30.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "remainingSeconds": 1170,
    "totalSeconds": 1200
  }
}
```

> 用途：每秒推送一次，客户端据此更新计时器显示。remainingSeconds 是服务器计算的权威值，客户端不自行计算。

**SS-10 SCORE_UPDATE（分数更新）**

```
{
  "type": "SCORE_UPDATE",
  "timestamp": "2026-07-10T14:08:00.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "teamId": 1,
    "teamName": "Alpha队",
    "teamTotalPoints": 350,
    "playerId": 10,
    "playerTotalPoints": 120
  }
}
```

> 用途：通知队伍成员分数变更。第一轮展示个人分，第二轮展示个人分和队伍分，第三轮展示队伍分。

**SS-11 CELL_BROADCAST（格子填写广播）**

```
{
  "type": "CELL_BROADCAST",
  "timestamp": "2026-07-10T15:00:05.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 3,
    "puzzleId": 20,
    "playerId": 10,
    "playerName": "张三",
    "row": 3,
    "col": 5,
    "value": 7
  }
}
```

> 用途：第三轮中，队员填写格子后广播给全队。其他队员的棋盘实时更新该格子的值。

**SS-14 PUZZLE_ASSIGN（题目分配）**

```
{
  "type": "PUZZLE_ASSIGN",
  "timestamp": "2026-07-10T14:05:01.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "puzzleId": 5,
    "puzzleType": "JOC",
    "orderInRound": 5,
    "initialGrid": [[5,3,0,0,7,0,0,0,0], ...],
    "points": 10,
    "letter": null
  }
}
```

> 注意：payload 中不包含 solution 字段，答案不会推送给客户端。

**SS-15 ANSWER_RESULT（答案判定结果）**

```
{
  "type": "ANSWER_RESULT",
  "timestamp": "2026-07-10T14:10:00.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "puzzleId": 5,
    "isCorrect": true,
    "pointsEarned": 10,
    "letter": "S"
  }
}
```

> 用途：告知选手答案是否正确。如果正确且是第一轮 JOC 题目，同时返回关联字母。如果错误，选手可以继续尝试（JOC 题目）或该题不得分（完整数独题）。

**SS-16 CELL_CONFLICT（格子冲突）**

```
{
  "type": "CELL_CONFLICT",
  "timestamp": "2026-07-10T15:00:05.500Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 3,
    "puzzleId": 20,
    "row": 3,
    "col": 5,
    "attemptedValue": 7,
    "actualValue": 4,
    "filledBy": "李四"
  }
}
```

> 用途：第三轮中，选手填写的格子已被其他队员先填入，通知该选手冲突信息。客户端应将该格子恢复为 actualValue。

**SS-17 PUZZLE_ROTATE（题目轮转）**

```
{
  "type": "PUZZLE_ROTATE",
  "timestamp": "2026-07-10T14:36:00.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 2,
    "fromPlayerId": 10,
    "fromPlayerName": "张三",
    "toPlayerId": 11,
    "toPlayerName": "李四",
    "puzzleId": 3,
    "currentGrid": [[5,3,4,6,7,0,0,0,0], ...],
    "isCompleted": false
  }
}
```

> 用途：第二轮每分钟轮转时，通知接收题目的队员。currentGrid 包含上一位队员的填写进度，队员在此基础上继续答题。

**SS-19 LETTER_REVEAL（字母揭示）**

```
{
  "type": "LETTER_REVEAL",
  "timestamp": "2026-07-10T14:12:00.000Z",
  "tournamentId": 1,
  "payload": {
    "roundId": 1,
    "puzzleId": 3,
    "letter": "U",
    "collectedLetters": ["S", "U", "D", "O", "K", "U"],
    "totalLetters": 9
  }
}
```

> 用途：第一轮中选手正确回答 JOC 题目后，揭示关联字母。collectedLetters 是选手已收集的所有字母，totalLetters 是需要收集的总数（9个）。当 collectedLetters 长度等于 totalLetters 时，选手可以解答第 10 题。

**SS-20 GAME_STATE_SYNC（比赛状态同步）**

```
{
  "type": "GAME_STATE_SYNC",
  "timestamp": "2026-07-10T14:15:00.000Z",
  "tournamentId": 1,
  "payload": {
    "tournamentStatus": "IN_PROGRESS",
    "currentRound": {
      "roundId": 1,
      "roundName": "九九归一",
      "roundType": "ROUND1_NINE_ONE",
      "status": "IN_PROGRESS",
      "remainingSeconds": 300
    },
    "playerState": {
      "assignedPuzzles": [
        { "puzzleId": 5, "puzzleType": "JOC", "isCompleted": true },
        { "puzzleId": 6, "puzzleType": "JOC", "isCompleted": false, "currentGrid": [...] }
      ],
      "score": 120,
      "collectedLetters": ["S", "U", "D", "O", "K", "U"]
    }
  }
}
```

> 用途：选手断线重连后，服务器推送完整的比赛状态，选手据此恢复界面。这是保证断线重连后状态一致的关键事件。

---

## 8.4 事件流程示例

### 8.4.1 第一轮答题流程

```
选手                           服务器
  │                              │
  │ SUBSCRIBE /topic/tournament/1│
  │─────────────────────────────►│
  │                              │
  │     ROUND_STARTED            │
  │◄─────────────────────────────│
  │                              │
  │     PUZZLE_ASSIGN (题1~9)    │
  │◄─────────────────────────────│
  │                              │
  │     PUZZLE_ASSIGN (题10)     │
  │◄─────────────────────────────│
  │                              │
  │     TIMER_TICK (每秒)        │
  │◄─────────────────────────────│
  │                              │
  │ ANSWER_SUBMIT (题3: value=7) │
  │─────────────────────────────►│
  │                              │
  │     ANSWER_RESULT (正确)     │
  │◄─────────────────────────────│
  │     LETTER_REVEAL (字母=U)   │
  │◄─────────────────────────────│
  │                              │
  │     SCORE_UPDATE             │
  │◄─────────────────────────────│
  │                              │
  │  ... 收集完9个字母后 ...      │
  │                              │
  │ ANSWER_SUBMIT (题10: full)   │
  │─────────────────────────────►│
  │                              │
  │     ANSWER_RESULT (正确)     │
  │◄─────────────────────────────│
  │     SCORE_UPDATE             │
  │◄─────────────────────────────│
  │                              │
  │     ROUND_FINISHED           │
  │◄─────────────────────────────│
```

### 8.4.2 第二轮轮转流程

```
选手A                          服务器
  │                              │
  │     PUZZLE_ASSIGN (题1)      │
  │◄─────────────────────────────│
  │                              │
  │ ANSWER_SUBMIT (题1: full)    │
  │─────────────────────────────►│
  │                              │
  │     ANSWER_RESULT (正确)     │
  │◄─────────────────────────────│
  │     PUZZLE_ASSIGN (题5)      │
  │◄─────────────────────────────│  ← 从题池分配新题
  │     SCORE_UPDATE             │
  │◄─────────────────────────────│
  │                              │
  │  ... 1分钟后轮转 ...          │
  │                              │
  │     PUZZLE_ROTATE            │
  │◄─────────────────────────────│  ← 题5未完成，轮转给选手B
  │     (题5从A转出)             │
  │     PUZZLE_ASSIGN (题6)      │
  │◄─────────────────────────────│  ← 系统分配题池中下一题
```

### 8.4.3 第三轮协作流程

```
选手A     选手B      服务器
  │         │          │
  │         │  PUZZLE_ASSIGN (题20)
  │◄────────┼──────────│  ← 全队收到同一题
  │         │          │
  │ CELL_FILL (R3C5=7)│
  │─────────┼─────────►│
  │         │          │
  │  CELL_BROADCAST (R3C5=7)
  │◄────────┼──────────│  → 选手B也收到
  │         │          │
  │         │ CELL_FILL(R3C5=7)  ← 选手B也填同一格
  │         │─────────►│
  │         │          │
  │         │ CELL_CONFLICT
  │         │◄─────────│  ← 服务器拒绝，该格已被A填
  │         │          │
  │         │ CELL_FILL(R3C6=3)
  │         │─────────►│
  │         │          │
  │  CELL_BROADCAST (R3C6=3)
  │◄────────┼──────────│  → 选手A也收到
```
