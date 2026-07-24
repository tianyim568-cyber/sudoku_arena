# 第六部分：数据库初步设计

## 6.1 主要实体

### 6.1.1 用户域（User Domain）

**User（用户）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 用户唯一标识 |
| username | VARCHAR(50) | UNIQUE, NOT NULL | 用户名，用于登录 |
| password | VARCHAR(255) | NOT NULL | BCrypt 加密后的密码 |
| role | VARCHAR(20) | NOT NULL | 角色：ADMIN / JUDGE / PLAYER |
| display_name | VARCHAR(100) | | 显示名称 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | NOT NULL | 更新时间 |

> 设计原因：MVP 阶段用户表只需要基本信息。display_name 用于比赛界面展示，与 username 分离，方便选手使用真实姓名作为显示名。role 使用 VARCHAR 而非 ENUM，因为 PostgreSQL 的 ENUM 类型修改不方便（新增值需要 ALTER TYPE），VARCHAR 更灵活。

---

### 6.1.2 比赛域（Tournament Domain）

**Tournament（比赛）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 比赛唯一标识 |
| name | VARCHAR(200) | NOT NULL | 比赛名称 |
| description | TEXT | | 比赛描述 |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'PENDING' | 比赛状态 |
| scheduled_time | TIMESTAMP | | 计划开始时间 |
| created_by | BIGINT | FK → User.id | 创建者 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW | 创建时间 |
| updated_at | TIMESTAMP | NOT NULL | 更新时间 |

status 取值：PENDING, READY, IN_PROGRESS, PAUSED, FINISHED

> 设计原因：Tournament 是整个系统的核心实体，所有比赛数据都围绕它组织。scheduled_time 是可选的，因为实际开始时间由裁判控制。created_by 记录是谁创建的比赛，用于权限校验。

**Round（轮次）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 轮次唯一标识 |
| tournament_id | BIGINT | FK → Tournament.id, NOT NULL | 所属比赛 |
| round_number | INT | NOT NULL | 轮次序号（1, 2, 3） |
| name | VARCHAR(100) | NOT NULL | 轮次名称（如「九九归一」） |
| round_type | VARCHAR(30) | NOT NULL | 轮次类型 |
| duration_seconds | INT | NOT NULL | 时长（秒） |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'NOT_STARTED' | 轮次状态 |
| started_at | TIMESTAMP | | 实际开始时间 |
| ended_at | TIMESTAMP | | 实际结束时间 |
| remaining_seconds | INT | | 剩余时间（秒），暂停时持久化 |

round_type 取值：ROUND1_NINE_ONE, ROUND2_RELAY, ROUND3_COLLABORATE
status 取值：NOT_STARTED, IN_PROGRESS, PAUSED, FINISHED

> 设计原因：Round 的 remaining_seconds 字段用于服务器重启后恢复计时。round_type 使用 VARCHAR 而非硬编码，方便 V2 扩展新赛制。round_number 确保轮次顺序正确。每轮有独立的 started_at 和 ended_at，记录实际时间而非计划时间。

**TournamentJudge（比赛-裁判关联）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 关联唯一标识 |
| tournament_id | BIGINT | FK → Tournament.id, NOT NULL | 比赛 |
| judge_id | BIGINT | FK → User.id, NOT NULL | 裁判 |
| assigned_at | TIMESTAMP | NOT NULL, DEFAULT NOW | 分配时间 |

> 设计原因：多对多关联表。一场比赛可以有多个裁判，一个裁判可以执法多场比赛。V2 功能。

---

### 6.1.3 题目域（Puzzle Domain）

**Puzzle（题目）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 题目唯一标识 |
| round_id | BIGINT | FK → Round.id, NOT NULL | 所属轮次 |
| puzzle_type | VARCHAR(20) | NOT NULL | 题目类型 |
| order_in_round | INT | NOT NULL | 在轮次中的顺序 |
| initial_grid | JSONB | NOT NULL | 初始棋盘状态 |
| solution | JSONB | NOT NULL | 正确答案 |
| points | INT | NOT NULL, DEFAULT 100 | 分值 |
| letter | VARCHAR(1) | | 关联字母（仅第一轮前9题） |
| metadata | JSONB | | 扩展元数据 |

puzzle_type 取值：JOC, STANDARD, FINAL

> 设计原因：initial_grid 和 solution 使用 JSONB 类型存储 9x9 二维数组，PostgreSQL 的 JSONB 支持索引和查询，且比 TEXT 列更高效。letter 字段仅第一轮前 9 题使用，其他题目为 NULL。metadata 字段预留扩展能力，V2 可以存储题目难度、来源等信息，不影响现有逻辑。

**PuzzleRelation（题目关联）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 关联唯一标识 |
| puzzle_id | BIGINT | FK → Puzzle.id, NOT NULL | 目标题目（第10题） |
| related_puzzle_id | BIGINT | FK → Puzzle.id, NOT NULL | 关联题目（前9题之一） |
| relation_type | VARCHAR(30) | NOT NULL | 关联类型 |

relation_type 取值：CLUE_PROVIDER（前9题提供线索给第10题）

> 设计原因：第一轮第10题与前9题的关联关系通过关联表维护，而不是在 Puzzle 表中硬编码。这种设计支持更灵活的关联类型，V2 可以扩展其他关联关系（如变体题、衍生题）。

---

### 6.1.4 队伍域（Team Domain）

**Team（队伍）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 队伍唯一标识 |
| tournament_id | BIGINT | FK → Tournament.id, NOT NULL | 所属比赛 |
| name | VARCHAR(100) | NOT NULL | 队伍名称 |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW | 创建时间 |

> 设计原因：队伍属于特定比赛，不同比赛的队伍互不影响。队名在同一比赛内唯一。

**TeamMember（队伍成员）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 关联唯一标识 |
| team_id | BIGINT | FK → Team.id, NOT NULL | 队伍 |
| player_id | BIGINT | FK → User.id, NOT NULL | 选手 |
| position | INT | | 在队伍中的位置（第二轮轮转顺序） |
| joined_at | TIMESTAMP | NOT NULL, DEFAULT NOW | 加入时间 |

> 设计原因：position 字段用于第二轮轮转顺序（A=1, B=2, C=3, D=4）。这个字段在创建队伍时由管理员指定或系统自动分配。第二轮开始前必须确保每队恰好 4 人且 position 为 1-4。

---

### 6.1.5 比赛状态域（Game State Domain）

**PlayerRoundState（选手-轮次状态）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 状态唯一标识 |
| round_id | BIGINT | FK → Round.id, NOT NULL | 轮次 |
| player_id | BIGINT | FK → User.id, NOT NULL | 选手 |
| team_id | BIGINT | FK → Team.id | 队伍（第二轮、第三轮使用） |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'WAITING' | 选手在该轮的状态 |

status 取值：WAITING, ACTIVE, COMPLETED, DISCONNECTED

> 设计原因：记录每位选手在每个轮次中的状态。第二轮中，如果选手断线，状态标记为 DISCONNECTED，重连后恢复为 ACTIVE。

**PlayerPuzzleAssignment（选手-题目分配）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 分配唯一标识 |
| round_id | BIGINT | FK → Round.id, NOT NULL | 轮次 |
| player_id | BIGINT | FK → User.id, NOT NULL | 选手 |
| puzzle_id | BIGINT | FK → Puzzle.id, NOT NULL | 题目 |
| assigned_at | TIMESTAMP | NOT NULL | 分配时间 |
| current_grid | JSONB | | 当前填写状态（保留轮转时的进度） |
| is_completed | BOOLEAN | NOT NULL, DEFAULT FALSE | 是否已完成 |
| completed_at | TIMESTAMP | | 完成时间 |

> 设计原因：这是第二轮题目轮转的核心数据结构。current_grid 记录选手当前在题目上的填写状态，轮转时这个状态会跟随题目一起转移给下一位队员。is_completed 标记题目是否已提交，已提交的题目不参与轮转。

---

### 6.1.6 答案与计分域（Scoring Domain）

**Submission（提交记录）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 提交唯一标识 |
| round_id | BIGINT | FK → Round.id, NOT NULL | 轮次 |
| player_id | BIGINT | FK → User.id, NOT NULL | 选手 |
| puzzle_id | BIGINT | FK → Puzzle.id, NOT NULL | 题目 |
| team_id | BIGINT | FK → Team.id | 队伍 |
| submission_type | VARCHAR(20) | NOT NULL | 提交类型 |
| submitted_value | JSONB | | 提交内容（单格数值或完整棋盘） |
| is_correct | BOOLEAN | NOT NULL | 是否正确 |
| points_earned | INT | NOT NULL, DEFAULT 0 | 获得分数 |
| submitted_at | TIMESTAMP | NOT NULL | 提交时间 |

submission_type 取值：SINGLE_CELL（JOC 题目提交单个数字）, FULL_GRID（完整棋盘提交）

> 设计原因：Submission 记录所有提交历史，是不可变的数据——一旦提交，不可修改。submission_type 区分不同类型的提交，JOC 题目只需提交一个数字，完整数独题需要提交整个棋盘。submitted_value 使用 JSONB 存储，可以灵活适配不同的提交格式。

**Score（分数）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGINT | PK, AUTO_INCREMENT | 分数唯一标识 |
| tournament_id | BIGINT | FK → Tournament.id, NOT NULL | 比赛 |
| round_id | BIGINT | FK → Round.id, NOT NULL | 轮次 |
| player_id | BIGINT | FK → User.id | 选手（个人分） |
| team_id | BIGINT | FK → Team.id | 队伍（队伍分） |
| score_type | VARCHAR(20) | NOT NULL | 分数类型 |
| total_points | INT | NOT NULL, DEFAULT 0 | 总分 |
| updated_at | TIMESTAMP | NOT NULL | 更新时间 |

score_type 取值：INDIVIDUAL（个人分）, TEAM（队伍分）

> 设计原因：分数表同时支持个人分和队伍分。第一轮主要记录个人分，第二轮记录个人分和队伍分，第三轮记录队伍分。total_points 是累计值，每次正确提交后累加。V2 可以增加排名、百分位等衍生数据。

---

## 6.2 实体关系

### 6.2.1 ER 关系图

```
User ──1:N──► TournamentJudge ──N:1──► Tournament
  │                                      │
  │                                      ├──1:N──► Round
  │                                      │            │
  │                                      │            └──1:N──► Puzzle ◄──N:N──► PuzzleRelation
  │                                      │
  │                                      ├──1:N──► Team
  │                                      │            │
  │                                      │            └──1:N──► TeamMember
  │                                      │
  │                                      ├──1:N──► Score
  │                                      │
  │                                      └──1:N──► PlayerRoundState
  │
  └──1:N──► Submission
               │
               └──1:N──► PlayerPuzzleAssignment
```

### 6.2.2 关系说明

| 关系 | 类型 | 说明 |
|------|------|------|
| Tournament → Round | 1:N | 一场比赛包含 3 个轮次 |
| Tournament → Team | 1:N | 一场比赛包含多支队伍 |
| Tournament → TournamentJudge | 1:N | 一场比赛可以有多个裁判 |
| Round → Puzzle | 1:N | 一个轮次包含多道题目 |
| Team → TeamMember | 1:N | 一支队伍包含多名选手 |
| Puzzle → PuzzleRelation | 1:N | 一道题目可以关联多道其他题目 |
| User → TournamentJudge | 1:N | 一个裁判可以执法多场比赛 |
| User → TeamMember | 1:N | 一个选手可以参加多场比赛（不同比赛） |
| User → Submission | 1:N | 一个选手有多次提交 |
| User → PlayerRoundState | 1:N | 一个选手在每个轮次有对应状态 |
| User → PlayerPuzzleAssignment | 1:N | 一个选手在每轮中被分配多道题目 |
| User → Score | 1:N | 一个选手在每轮中有分数记录 |
| Round → PlayerRoundState | 1:N | 一个轮次包含所有选手的状态 |
| Round → PlayerPuzzleAssignment | 1:N | 一个轮次包含所有题目分配 |
| Round → Submission | 1:N | 一个轮次包含所有提交记录 |
| Round → Score | 1:N | 一个轮次包含所有分数记录 |

### 6.2.3 唯一约束

| 约束 | 字段组合 | 说明 |
|------|----------|------|
| UK_TOURNAMENT_JUDGE | (tournament_id, judge_id) | 同一裁判不能重复分配到同一比赛 |
| UK_TEAM_MEMBER | (team_id, player_id) | 同一选手不能重复加入同一队伍 |
| UK_PLAYER_ROUND_STATE | (round_id, player_id) | 同一选手在同一轮次只有一个状态 |
| UK_PLAYER_PUZZLE | (round_id, player_id, puzzle_id) | 同一选手对同一题目只有一个分配记录 |
| UK_ROUND_NUMBER | (tournament_id, round_number) | 同一比赛的轮次序号不重复 |
| UK_PUZZLE_ORDER | (round_id, order_in_round) | 同一轮次的题目顺序不重复 |

> 设计原因：唯一约束是数据完整性的最后一道防线。即使应用层做了校验，数据库约束可以防止并发场景下的数据不一致。UK_PLAYER_PUZZLE 特别重要——第二轮轮转时，必须确保同一题目同一时间只分配给一位选手。
