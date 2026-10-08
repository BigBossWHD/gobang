// 新旧引擎使用同样的开局和候选宽度，支持分别设置时间与节点预算；每个开局交换执棋颜色。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEngine, createPosition } = require('./helpers/ai-harness.cjs');
const { hasFive } = require('./helpers/rules.cjs');
function parseArgs(args) {
    const options = { baseline: '8a4f590', candidate: 'working', timeMs: 250, nodeLimit: 4000, candidateTimeMs: null, candidateNodeLimit: null, maxMoves: 100, rounds: 1, seed: 20261008, deterministic: false, output: null };
    const numeric = { '--candidate-time-ms': 'candidateTimeMs', '--candidate-node-limit': 'candidateNodeLimit', '--time-ms': 'timeMs', '--node-limit': 'nodeLimit', '--max-moves': 'maxMoves', '--rounds': 'rounds', '--seed': 'seed' };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--deterministic') options.deterministic = true;
        else if (numeric[arg]) options[numeric[arg]] = Number(args[++i]);
        else if (['--baseline', '--candidate', '--output'].includes(arg)) options[arg.slice(2)] = args[++i];
        else throw new Error(`未知选项：${arg}`);
    }
    options.candidateTimeMs ??= options.timeMs;
    options.candidateNodeLimit ??= options.nodeLimit;
    for (const name of ['candidateTimeMs', 'candidateNodeLimit', 'timeMs', 'nodeLimit', 'maxMoves', 'rounds', 'seed']) {
        if (!Number.isInteger(options[name]) || options[name] < (['timeMs', 'candidateTimeMs', 'seed'].includes(name) ? 0 : 1)) throw new Error(`无效参数：${name}`);
    }
    if (options.maxMoves > 225 || options.rounds > 100 || options.timeMs > 60000 || options.candidateTimeMs > 60000) throw new Error('参数超出合理范围');
    if (!options.baseline || !options.candidate || options.output === undefined) throw new Error('缺少参数值');
    return options;
}
const openings = [
    { name: '相邻直线', moves: [[7, 7], [7, 8]] },
    { name: '相邻斜线', moves: [[7, 7], [6, 6]] },
    { name: '偏离中心', moves: [[5, 6], [6, 6]] },
    { name: '分散布局', moves: [[7, 7], [5, 5], [8, 6], [6, 8]] }
];
function percentile(values, fraction) {
    if (!values.length) return 0;
    return +[...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)].toFixed(2);
}
function runComparison(options) {
    const engines = { baseline: loadEngine(options.baseline), candidate: loadEngine(options.candidate) };
    const report = { schemaVersion: 1, options, engines: { baseline: engines.baseline.revision, candidate: engines.candidate.revision },
        candidateSourceSha256: options.candidate === 'working' ? crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'ai.js'))).digest('hex') : null,
        nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, matches: [], summary: {} };
    const timings = { baseline: [], candidate: [] };
    for (let round = 0; round < options.rounds; round++) {
        for (let openingIndex = 0; openingIndex < openings.length; openingIndex++) {
            const opening = openings[openingIndex];
            for (const candidateColor of ['black', 'white']) {
                const matchSeed = (options.seed + round * openings.length + openingIndex) >>> 0;
                const pair = {};
                for (const identity of ['baseline', 'candidate']) pair[identity] = createPosition(loadEngine(options[identity], matchSeed, options.deterministic));
                let board = Array.from({ length: 15 }, () => Array(15).fill(null));
                const history = [];
                for (let i = 0; i < opening.moves.length; i++) {
                    const [ox, oy] = opening.moves[i];
                    // 每轮换方向；同一开局的一对比赛保持完全相同的棋盘。
                    const [x, y] = round % 2 ? [oy, 14 - ox] : [ox, oy];
                    const player = i % 2 ? 'white' : 'black';
                    if (board[x][y] !== null) throw new Error('开局坐标重复');
                    board[x][y] = player;
                    if (hasFive(board, x, y, player)) throw new Error('开局已结束');
                    history.push({ x, y, player });
                }
                const match = { opening: opening.name, round, seed: matchSeed, candidateColor, outcome: 'capped', winner: null, plies: 0, moves: history };
                for (let ply = history.length; ply < options.maxMoves; ply++) {
                    const player = ply % 2 ? 'white' : 'black';
                    const identity = player === candidateColor ? 'candidate' : 'baseline';
                    const game = pair[identity];
                    game.board = board.map(row => row.slice());
                    game.moveHistory = history.map(move => ({ ...move }));
                    const before = JSON.stringify(game.board);
                    const started = performance.now();
                    const move = game.getSearchedMove(player, { timeLimit: identity === 'candidate' ? options.candidateTimeMs : options.timeMs, nodeLimit: identity === 'candidate' ? options.candidateNodeLimit : options.nodeLimit, maxDepth: 6, rootWidth: 16 });
                    timings[identity].push(performance.now() - started);
                    if (JSON.stringify(game.board) !== before) throw new Error(`${identity} 搜索改变棋盘`);
                    if (!move || !Number.isInteger(move.x) || !Number.isInteger(move.y) || board[move.x]?.[move.y] !== null) throw new Error(`${identity} 返回非法棋步`);
                    board[move.x][move.y] = player;
                    history.push({ x: move.x, y: move.y, player });
                    if (hasFive(board, move.x, move.y, player)) { match.outcome = 'win'; match.winner = identity; break; }
                    if (history.length === 225) match.outcome = 'draw';
                }
                match.plies = history.length;
                report.matches.push(match);
                console.log(JSON.stringify({ opening: match.opening, candidateColor, outcome: match.outcome, winner: match.winner, plies: match.plies }));
            }
        }
    }
    const wins = report.matches.filter(match => match.winner === 'candidate').length;
    const losses = report.matches.filter(match => match.winner === 'baseline').length;
    report.summary = { games: report.matches.length, candidateWins: wins, baselineWins: losses,
        draws: report.matches.filter(match => match.outcome === 'draw').length,
        capped: report.matches.filter(match => match.outcome === 'capped').length,
        candidateWinRateAllGames: +(wins / report.matches.length).toFixed(4),
        timingsMs: Object.fromEntries(Object.entries(timings).map(([identity, values]) => [identity,
            { moves: values.length, total: +values.reduce((a, b) => a + b, 0).toFixed(2), median: percentile(values, 0.5), p95: percentile(values, 0.95), max: percentile(values, 1) }])) };
    if (options.output) {
        const destination = path.resolve(options.output);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, JSON.stringify(report, null, 4) + '\n');
    }
    console.log(JSON.stringify({ summary: report.summary }));
    return report;
}
if (require.main === module) runComparison(parseArgs(process.argv.slice(2)));
module.exports = { parseArgs, openings, runComparison };
