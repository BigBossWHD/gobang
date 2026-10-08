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
    assert.ok(performance.now() - started < 3000);
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


const forcingBlack = [[10, 6], [7, 5], [5, 8], [9, 5], [9, 7], [9, 10], [8, 8]];
const forcingWhite = [[4, 10], [4, 7], [7, 7], [9, 6], [5, 6], [7, 6], [10, 5], [8, 5], [9, 9], [6, 9]];
function forcingContext() {
    return { deadline: performance.now() + 1000, nodes: 0, nodeLimit: 10000, timeout: {} };
}

for (const [name, transform] of [['原位', ([x, y]) => [x, y]], ['旋转', ([x, y]) => [y, 14 - x]]]) {
    for (const player of ['white', 'black']) {
        test(`困难连续冲四：${name}/${player} 找到三次进攻的必胜线`, () => {
            const attackers = forcingWhite.map(transform);
            const defenders = forcingBlack.map(transform);
            const game = player === 'white' ? position(defenders, attackers) : position(attackers, defenders);
            const before = JSON.stringify(game.board);
            assert.equal(game.findContinuousFour(player, 2, forcingContext()), null);
            const move = game.getHardMove(player);
            assert.deepEqual([move.x, move.y], transform([7, 8]));
            assert.equal(JSON.stringify(game.board), before);
            // 固定胜法逐手验证：前两次只能挡一个成五点，第三次产生两个成五点。
            for (const [attack, block] of [[[7, 8], [8, 7]], [[7, 9], [7, 10]]]) {
                const [x, y] = transform(attack);
                game.board[x][y] = player;
                const wins = game.getImmediateWinningMoves(player);
                assert.deepEqual(Array.from(wins, m => [m.x, m.y]), [transform(block)]);
                assert.equal(game.getImmediateWinningMoves(game.getOpponent(player)).length, 0);
                const [bx, by] = transform(block);
                game.board[bx][by] = game.getOpponent(player);
            }
            const [x, y] = transform([8, 9]);
            game.board[x][y] = player;
            assert.equal(game.getImmediateWinningMoves(player).length, 2);
            assert.equal(game.getImmediateWinningMoves(game.getOpponent(player)).length, 0);
        });
    }
}

test('连续冲四不能忽略对方已经存在的成五点', () => {
    const game = position([...forcingBlack, [1, 3], [1, 4], [1, 5], [1, 6]], [...forcingWhite, [1, 2]]);
    const before = JSON.stringify(game.board);
    assert.equal(game.findContinuousFour('white', 6, forcingContext()), null);
    assert.equal(JSON.stringify(game.board), before);
});

test('连续冲四深层预算耗尽会恢复试放的攻防棋子', () => {
    const game = position(forcingBlack, forcingWhite);
    const before = JSON.stringify(game.board);
    const context = forcingContext();
    context.nodeLimit = 2;
    assert.throws(() => game.findContinuousFour('white', 6, context), error => error === context.timeout);
    assert.equal(JSON.stringify(game.board), before);
});


const defenseBlack = [[7, 10], [5, 8], [3, 8], [6, 11], [8, 7], [4, 8], [10, 7], [10, 10], [5, 11], [4, 10], [11, 10]];
const defenseWhite = [[5, 3], [9, 10], [6, 10], [7, 8], [7, 9], [9, 9], [4, 4], [9, 6], [6, 5], [9, 4], [3, 6]];
for (const [name, transform] of [['原位', ([x, y]) => [x, y]], ['镜像', ([x, y]) => [x, 14 - y]]]) {
    for (const player of ['white', 'black']) {
        test(`困难拆连续杀棋：${name}/${player} 提前封住关键点`, () => {
            const game = player === 'white' ? position(defenseBlack.map(transform), defenseWhite.map(transform))
                : position(defenseWhite.map(transform), defenseBlack.map(transform));
            const before = JSON.stringify(game.board);
            const opponent = game.getOpponent(player);
            // 旧版选择的抢攻点，会给对手留下经过逐手验证的强制胜法。
            const [oldX, oldY] = transform([9, 7]);
            game.board[oldX][oldY] = player;
            const [firstX, firstY] = transform([9, 8]);
            game.board[firstX][firstY] = opponent;
            const wins = game.getImmediateWinningMoves(opponent);
            assert.deepEqual(Array.from(wins, m => [m.x, m.y]), [transform([8, 9])]);
            assert.equal(game.getImmediateWinningMoves(player).length, 0);
            const [blockX, blockY] = transform([8, 9]);
            game.board[blockX][blockY] = player;
            const [secondX, secondY] = transform([10, 9]);
            game.board[secondX][secondY] = opponent;
            assert.equal(game.getImmediateWinningMoves(opponent).length, 2);
            assert.equal(game.getImmediateWinningMoves(player).length, 0);
            game.board = JSON.parse(before);
            const move = game.getHardMove(player);
            assert.deepEqual([move.x, move.y], transform([9, 8]));
            assert.equal(JSON.stringify(game.board), before);
            game.board[move.x][move.y] = player;
            assert.equal(game.findContinuousFour(opponent, 6, forcingContext()), null);
        });
    }
}

test('杀棋防守点即使在普通候选宽度之外也纳入搜索', () => {
    const game = position(defenseBlack, defenseWhite);
    const before = JSON.stringify(game.board);
    const root = [{ x: 9, y: 7, score: 1 }];
    const defenses = game.filterLosingDefenses('white', root, 6, forcingContext());
    assert.ok(defenses.some(move => move.x === 9 && move.y === 8));
    assert.ok(!defenses.some(move => move.x === 9 && move.y === 7));
    assert.equal(JSON.stringify(game.board), before);
});

test('防守筛选超时保留未证明的应手并恢复棋盘', () => {
    const game = position(defenseBlack, defenseWhite);
    const before = JSON.stringify(game.board);
    const proofContext = forcingContext();
    game.findContinuousFour('black', 6, proofContext);
    const limited = forcingContext();
    limited.nodeLimit = proofContext.nodes + 1;
    const root = game.getSearchMoves('white').slice(0, 16);
    const defenses = game.filterLosingDefenses('white', root, 6, limited);
    assert.ok(defenses.length > 0);
    assert.ok(defenses.some(move => move.x === 9 && move.y === 8));
    assert.equal(JSON.stringify(game.board), before);
});

test('所有防守都被证明无法解杀时保留合法回退', () => {
    const game = position([[7, 4], [7, 5], [7, 6], [7, 7]], [[6, 6]]);
    const before = JSON.stringify(game.board);
    const root = game.getSearchMoves('white');
    const defenses = game.filterLosingDefenses('white', root, 6, forcingContext());
    assert.equal(defenses, root);
    assert.equal(JSON.stringify(game.board), before);
});
