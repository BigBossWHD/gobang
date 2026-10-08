const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/tactics.json');
const { loadEngine, createPosition } = require('./helpers/ai-harness.cjs');
const { hasFive, winningCells, verifyThreatProof } = require('./helpers/rules.cjs');
const engine = loadEngine();
const context = () => ({ deadline: performance.now() + 2000, nodes: 0, nodeLimit: 10000, timeout: {} });

for (const fixture of fixtures) {
    for (const [symmetry, transform] of [['原位', ([x, y]) => [x, y]], ['旋转', ([x, y]) => [y, 14 - x]]]) {
        for (const player of ['white', 'black']) {
            test(`题库/${fixture.id}/${symmetry}/${player}：${fixture.title}`, () => {
                const white = fixture.white.map(transform);
                const black = fixture.black.map(transform);
                const game = player === 'white' ? createPosition(engine, black, white) : createPosition(engine, white, black);
                const before = JSON.stringify(game.board);
                // 题库允许研究型摆局；要求无重叠、无已结束的五连，不要求子数平衡。
                for (const color of ['black', 'white']) {
                    for (let x = 0; x < 15; x++) for (let y = 0; y < 15; y++) {
                        if (game.board[x][y] === color) assert.ok(!hasFive(game.board, x, y, color), '题目不能从已结束的局面开始');
                    }
                }
                if (fixture.goal === 'line') {
                    const [x, y] = transform(fixture.anchor);
                    const [tx, ty] = transform([fixture.anchor[0] + fixture.direction[0], fixture.anchor[1] + fixture.direction[1]]);
                    const line = game.getLineStats(x, y, tx - x, ty - y, player);
                    assert.ok(!(line.length === 3 && line.openEnds === 2));
                } else if (['noProof', 'rejectProof', 'threatProof'].includes(fixture.goal)) {
                    const proof = game.findContinuousThreat(player, fixture.depth, context());
                    if (fixture.goal === 'noProof') assert.equal(proof, null);
                    else if (fixture.goal === 'rejectProof') {
                        const rejected = fixture.reject.map(transform);
                        if (proof) assert.ok(!rejected.some(([x, y]) => proof.x === x && proof.y === y));
                        assert.equal(verifyThreatProof(game.board, player,
                            { x: rejected[0][0], y: rejected[0][1] }, [{ x: rejected[0][0], y: rejected[0][1] }], 2), false);
                    } else {
                        assert.ok(proof, '必须找到胜法');
                        if (fixture.accept) assert.ok(fixture.accept.map(transform).some(([x, y]) => proof.x === x && proof.y === y));
                        assert.ok(verifyThreatProof(game.board, player, proof, proof.forcingLine, fixture.depth + 1), '独立穷举所有合法防守验证胜法');
                        const move = game.getHardMove(player);
                        if (fixture.accept) assert.ok(fixture.accept.map(transform).some(([x, y]) => move.x === x && move.y === y));
                    }
                } else {
                    for (const level of fixture.levels) {
                        const move = game[`get${level[0].toUpperCase() + level.slice(1)}Move`](player);
                        assert.ok(move && game.board[move.x]?.[move.y] === null);
                        assert.equal(JSON.stringify(game.board), before);
                        game.board[move.x][move.y] = player;
                        if (fixture.goal === 'win') assert.ok(hasFive(game.board, move.x, move.y, player));
                        else if (fixture.goal === 'doubleWin') assert.ok(winningCells(game.board, player).length >= 2);
                        else if (fixture.goal === 'defendFork') {
                            const [x, y] = transform(fixture.threat);
                            const cells = fixture.attackCells.map(transform).map(([x, y]) => ({ x, y }));
                            assert.equal(verifyThreatProof(game.board, game.getOpponent(player), { x, y }, cells, 2), false);
                        }
                        else assert.ok(fixture.accept.map(transform).some(([x, y]) => move.x === x && move.y === y));
                        game.board[move.x][move.y] = null;
                    }
                }
                assert.equal(JSON.stringify(game.board), before);
            });
        }
    }
}

test('活三分支搜索中断后恢复所有攻防试放子', () => {
    const fixture = fixtures.find(item => item.id === 'continuous-three-attack');
    const game = createPosition(engine, fixture.black, fixture.white);
    const before = JSON.stringify(game.board);
    const limited = context(); limited.nodeLimit = 4;
    assert.throws(() => game.findContinuousThreat('white', 4, limited), error => error === limited.timeout);
    assert.equal(JSON.stringify(game.board), before);
});

test('精确成五点与独立逐格规则扫描一致', () => {
    for (const fixture of fixtures.filter(item => !['noProof', 'line'].includes(item.goal))) {
        const game = createPosition(engine, fixture.black, fixture.white);
        for (const player of ['black', 'white']) {
            const expected = winningCells(game.board, player).map(move => `${move.x},${move.y}`).sort();
            const actual = Array.from(game.getExactThreatWindows(player).wins, move => `${move.x},${move.y}`).sort();
            assert.deepEqual(actual, expected);
        }
    }
});

test('活三分支不会忽略可打断进攻的冲四反击', () => {
    const fixture = fixtures.find(item => item.id === 'counter-four-refutes-fork');
    const game = createPosition(engine, fixture.black, fixture.white);
    const before = JSON.stringify(game.board);
    assert.equal(game.findContinuousThreat('white', 3, context(), { x: 7, y: 7 }), null);
    assert.equal(JSON.stringify(game.board), before);
});

test('所有冲四反击点与独立试放枚举一致，包括跳三和边角', () => {
    for (const stones of [[[7, 4], [7, 5], [7, 6]], [[7, 4], [7, 6], [7, 7]], [[0, 0], [1, 1], [2, 2]]]) {
        const game = createPosition(engine, [[12, 12]], stones);
        const expected = [];
        for (let x = 0; x < 15; x++) for (let y = 0; y < 15; y++) {
            if (game.board[x][y] !== null) continue;
            game.board[x][y] = 'white';
            if (winningCells(game.board, 'white').length) expected.push(`${x},${y}`);
            game.board[x][y] = null;
        }
        const actual = Array.from(game.getExactThreatWindows('white').fours, move => `${move.x},${move.y}`).sort();
        assert.deepEqual(actual, expected.sort());
    }
});

test('相较固定旧版，新版选中的活三胜法可通过独立防守穷举', () => {
    const fixture = fixtures.find(item => item.id === 'continuous-three-attack');
    const old = createPosition(loadEngine('8a4f590', 20261008, true), fixture.black, fixture.white);
    const oldMove = old.getHardMove('white');
    const game = createPosition(engine, fixture.black, fixture.white);
    const newMove = game.getHardMove('white');
    assert.notDeepEqual([newMove.x, newMove.y], [oldMove.x, oldMove.y]);
    assert.equal(game.findContinuousThreat('white', 3, context(), oldMove), null);
    const proof = game.findContinuousThreat('white', 3, context(), newMove);
    assert.ok(proof);
    assert.ok(verifyThreatProof(game.board, 'white', newMove, proof.forcingLine, 4));
});
