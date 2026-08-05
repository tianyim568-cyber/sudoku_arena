// Translation table for server-originated error messages.
// The backend returns these strings hardcoded in Chinese (with a stable
// numeric `code`). We translate them on the client, keyed by the exact
// Chinese string. Unknown strings pass through unchanged, and in Chinese
// mode we return them as-is.
const EN = {
  // Auth / permissions
  '未登录': 'You are not logged in',
  'Token无效或已过期': 'Your session token is invalid or has expired',
  '权限不足': 'Insufficient permissions',
  '登录尝试过于频繁，请15分钟后再试': 'Too many login attempts, please try again in 15 minutes',
  '用户名和密码不能为空': 'Username and password are required',
  '用户名或密码错误': 'Incorrect username or password',
  '用户不存在': 'User not found',
  '用户名已存在': 'Username already exists',
  '缺少必填字段': 'Missing required field(s)',
  '角色值无效': 'Invalid role value',

  // Tournaments / rounds / teams (REST)
  '比赛不存在': 'Tournament not found',
  '比赛名称不能为空': 'Tournament name cannot be empty',
  '比赛进行中，无法删除，请先结束比赛': 'Cannot delete: the tournament is in progress. End it first.',
  '比赛已开始，无法修改': 'The tournament has started and cannot be modified',
  '轮次数量已达上限(3个)': 'Maximum number of rounds reached (3)',
  '题目数据格式错误': 'Invalid puzzle data format',
  '轮次不存在': 'Round not found',
  '队伍名称不能为空': 'Team name cannot be empty',
  '缺少选手ID': 'Missing player ID',
  '选手已在该队伍中': 'Player is already in this team',
  '选手已分配到其他队伍': 'Player is already assigned to another team',
  '缺少裁判ID': 'Missing judge ID',
  '裁判已分配': 'Judge already assigned',

  // Puzzle bank
  '题目不存在': 'Puzzle not found',
  '缺少轮次类型': 'Missing round type',
  '缺少队伍数量': 'Missing team count',
  '缺少轮次ID': 'Missing round ID',

  // Game engine (thrown errors / results)
  '轮次未在进行中': 'The round is not in progress',
  '该题目未分配给你或已提交': 'This puzzle is not assigned to you or has already been submitted',
  '缺少棋盘数据': 'Missing board data',
  '格子已被其他队员占用': 'This cell is already taken by another teammate',
  '初始格子不可修改': 'Initial cells cannot be modified',
  '未找到你的队伍': 'Your team was not found',
  '该题目未分配给你': 'This puzzle is not assigned to you',
  '题目未分配给你': 'The puzzle is not assigned to you',
  '比赛状态不允许开始': "The tournament's status does not allow starting",
  '轮次配置不完整': 'Round configuration is incomplete',
  '没有队伍': 'No teams',
  '轮次状态不允许开始': "The round's status does not allow starting",
  '比赛未在进行中': 'The tournament is not in progress',
  '比赛状态不允许暂停': "The tournament's status does not allow pausing",
  '比赛状态不允许恢复': "The tournament's status does not allow resuming",
  '轮次状态不允许结束': "The round's status does not allow ending",
  '比赛状态不允许结束': "The tournament's status does not allow ending",
  '所有轮次必须完成后才能结束比赛': 'All rounds must be finished before ending the tournament',

  // Participant import
  'Excel文件解析失败': 'Failed to parse Excel file',
  'Excel文件格式错误，请检查表头': 'Invalid Excel format, please check the headers',
  '没有有效的数据行': 'No valid data rows found',
  '选手导入失败': 'Participant import failed',
  '导入所有选手失败，已回滚全部操作': 'Failed to import all participants, all changes rolled back',
  '选手导入成功': 'Participants successfully imported',
  '请上传Excel文件': 'Please upload an Excel file',
  '查询选手失败': 'Failed to query participants',
  '删除选手失败': 'Failed to delete participants',
  '导出选手信息失败': 'Failed to export participant information',
  '没有可导出的选手数据': 'No participant data to export',
};

/**
 * Translate a server message to the given language.
 * @param {string} message - the raw message from the server
 * @param {string} lang - 'zh' | 'en'
 */
export function translateServerMessage(message, lang) {
  if (!message || lang !== 'en') return message; // zh: keep as-is
  return EN[message] || message; // unknown → pass through unchanged
}
