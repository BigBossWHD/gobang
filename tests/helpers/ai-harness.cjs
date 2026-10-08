const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

function loadEngine(ref = 'working', seed = 20261008, deterministic = false) {
    const revision = ref === 'working' ? null : execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    const randomMath = Object.create(Math);
    randomMath.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const context = vm.createContext({ window: {}, console, Math: randomMath,
        performance: deterministic ? { now: () => 0 } : performance });
    for (const file of ['script.js', 'ai.js']) {
        const source = revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8' })
            : fs.readFileSync(path.join(root, file), 'utf8');
        vm.runInContext(source, context, { filename: file });
    }
    return { Game: context.window.GomokuGame, revision: revision || 'working' };
}

function createPosition(engine, black = [], white = []) {
    const game = Object.create(engine.Game.prototype);
    Object.assign(game, { boardSize: 15, board: Array.from({ length: 15 }, () => Array(15).fill(null)), moveHistory: [] });
    for (const [player, stones] of [['black', black], ['white', white]]) {
        for (const [x, y] of stones) {
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 15 || y < 0 || y >= 15 || game.board[x][y] !== null) throw new Error('题库坐标非法或重叠');
            game.board[x][y] = player;
            game.moveHistory.push({ x, y, player });
        }
    }
    return game;
}
module.exports = { loadEngine, createPosition };
