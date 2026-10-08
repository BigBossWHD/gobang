const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ window: {}, console, performance, Date, Set, Map });
for (const file of ['script.js', 'ai.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
function position(black = [], white = []) {
    const game = Object.create(context.window.GomokuGame.prototype);
    Object.assign(game, { boardSize: 15, board: Array.from({ length: 15 }, () => Array(15).fill(null)), moveHistory: [], aiPlayer: 'white' });
    for (const [player, stones] of [['black', black], ['white', white]]) {
        for (const [x, y] of stones) {
            game.board[x][y] = player;
            game.moveHistory.push({ x, y, player });
        }
    }
    return game;
}

test('搜索必须考虑对手最强的成五应手', () => {
    const game = position([[7, 4], [7, 5], [7, 6], [7, 7]], [[7, 3]]);
    const before = JSON.stringify(game.board);
    assert.ok(game.minimaxSearch(1, -Infinity, Infinity, 'black', 'white') < -90000);
    assert.equal(JSON.stringify(game.board), before);
});

test('识别跳三，并区分被封住的伪活三', () => {
    const game = position([[7, 6], [7, 7], [7, 9]]);
    let stats = game.getLineStats(7, 7, 0, 1, 'black');
    assert.equal(stats.length, 3);
    assert.equal(stats.openEnds, 2);
    game.board[7][5] = 'white';
    stats = game.getLineStats(7, 7, 0, 1, 'black');
    assert.ok(!(stats.length === 3 && stats.openEnds === 2));
});

test('识别中间留空的跳四', () => {
    const game = position([[7, 4], [7, 5], [7, 7], [7, 8]]);
    const stats = game.getLineStats(7, 7, 0, 1, 'black');
    assert.equal(stats.length, 4);
    assert.equal(stats.openEnds, 1);
});

for (const difficulty of ['Easy', 'Medium', 'Hard']) {
    test(`${difficulty}：己方成五优先于挡住对手`, () => {
        const game = position([[2, 3], [2, 4], [2, 5], [2, 6]], [[10, 3], [10, 4], [10, 5], [10, 6]]);
        const before = JSON.stringify(game.board);
        const move = game[`get${difficulty}Move`]('white');
        assert.equal(JSON.stringify(game.board), before);
        game.board[move.x][move.y] = 'white';
        assert.ok(game.checkWin(move.x, move.y));
    });
}

for (const [name, transform] of [
    ['原位', ([x, y]) => [x, y]],
    ['旋转', ([x, y]) => [y, 14 - x]],
    ['镜像', ([x, y]) => [x, 14 - y]],
    ['对角线', ([x, y]) => [y, x]]
]) {
    for (const color of ['white', 'black']) {
        test(`困难：${name}/${color} 必须封住跳四的中间空点`, () => {
            const attacker = [[7, 4], [7, 5], [7, 7], [7, 8]].map(transform);
            const defender = [[6, 6], [8, 6]].map(transform);
            const game = color === 'white' ? position(attacker, defender) : position(defender, attacker);
            const before = JSON.stringify(game.board);
            const move = game.getHardMove(color);
            assert.deepEqual([move.x, move.y], transform([7, 6]));
            assert.equal(JSON.stringify(game.board), before);
        });
    }
}

test('困难：制造双向活四，而不是随意防守', () => {
    const game = position([[5, 5], [6, 5], [9, 9]], [[7, 6], [7, 7], [7, 8]]);
    const before = JSON.stringify(game.board);
    const move = game.getHardMove('white');
    assert.equal(JSON.stringify(game.board), before);
    game.board[move.x][move.y] = 'white';
    assert.ok(game.getImmediateWinningMoves('white').length >= 2);
});

test('困难：阻止对手下一手形成双活三', () => {
    const game = position([[7, 6], [7, 8], [6, 7], [8, 7]], [[4, 4], [10, 10]]);
    const before = JSON.stringify(game.board);
    const move = game.getHardMove('white');
    assert.equal(JSON.stringify(game.board), before);
    game.board[move.x][move.y] = 'white';
    if (game.board[7][7] === null) {
        game.board[7][7] = 'black';
        const profile = game.getThreatProfile(game.collectLineStats(7, 7, 'black'));
        assert.ok(profile.openThrees < 2);
    }
});

test('搜索预算耗尽仍返回合法棋步且恢复棋盘', () => {
    const game = position([[7, 7], [6, 6], [8, 8]], [[7, 8], [8, 7]]);
    const before = JSON.stringify(game.board);
    const started = performance.now();
    const move = game.getHardMove('white');
    assert.equal(JSON.stringify(game.board), before);
    assert.equal(game.board[move.x][move.y], null);
    assert.ok(performance.now() - started < 2000);
});

test('空棋盘悔棋不会取消 AI 的首次行棋', () => {
    const game = position();
    game.aiTurnSerial = 0;
    game.undoMove();
    assert.equal(game.aiTurnSerial, 0);
});

test('重开时终止后台搜索，并让等待中的回合安全结束', async () => {
    let terminated = false;
    context.Worker = class {
        postMessage(data) { assert.equal(data.apiKey, undefined); }
        terminate() { terminated = true; }
    };
    try {
        const game = position([[7, 7]]);
        game.aiTurnSerial = 0;
        const pending = game.getHardMoveAsync('white');
        game.cancelScheduledAIMove();
        assert.equal(await pending, null);
        assert.equal(game.aiSearchWorker, null);
        assert.equal(terminated, true);
        assert.equal(game.aiTurnSerial, 1);
    } finally {
        delete context.Worker;
    }
});

for (const difficulty of ['Easy', 'Medium', 'Hard']) {
    test(`${difficulty}：己方无即胜时必须挡住对手成五`, () => {
        const game = position([[7, 3], [7, 4], [7, 5], [7, 6]], [[7, 2], [9, 9]]);
        const before = JSON.stringify(game.board);
        const move = game[`get${difficulty}Move`]('white');
        assert.deepEqual([move.x, move.y], [7, 7]);
        assert.equal(JSON.stringify(game.board), before);
    });
}

test('预算在搜索前耗尽也有合法回退，不改变棋盘', () => {
    const game = position([[7, 7], [6, 6]], [[7, 8]]);
    const before = JSON.stringify(game.board);
    const move = game.getSearchedMove('white', { timeLimit: 0 });
    assert.equal(game.board[move.x][move.y], null);
    assert.equal(JSON.stringify(game.board), before);
});
