// 固定随机种子的本地难度对局比较；有限局数不能代表棋力等级。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const levels = { easy: 'getEasyMove', medium: 'getMediumMove', hard: 'getHardMove' };
function createGame(seed) {
    const randomMath = Object.create(Math);
    randomMath.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const context = vm.createContext({ window: {}, console, performance, Math: randomMath });
    for (const name of ['script.js', 'ai.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context);
    }
    const game = Object.create(context.window.GomokuGame.prototype);
    Object.assign(game, { boardSize: 15, board: Array.from({length:15}, () => Array(15).fill(null)), moveHistory: [] });
    return game;
}
const pairings = [['medium','easy'],['easy','medium'],['hard','easy'],['easy','hard'],['hard','medium'],['medium','hard']];
for (let match = 0; match < pairings.length; match++) {
    const [black, white] = pairings[match];
    const game = createGame(20261008 + match);
    let outcome = '达到步数上限';
    const elapsed = {black:0,white:0};
    let count = 0;
    for (; count < 100; count++) {
        const player = count % 2 ? 'white' : 'black';
        const level = player === 'black' ? black : white;
        const before = JSON.stringify(game.board);
        const started = performance.now();
        const move = game[levels[level]](player);
        elapsed[player] += performance.now() - started;
        if (JSON.stringify(game.board) !== before) throw new Error('搜索改变了棋盘');
        if (!move || !game.isInsideBoard(move.x, move.y) || game.board[move.x][move.y] !== null) throw new Error('非法棋步');
        game.board[move.x][move.y] = player;
        game.moveHistory.push({ ...move, player });
        if (game.checkWin(move.x, move.y)) { outcome = `${level}（${player}）获胜`; count++; break; }
    }
    console.log(JSON.stringify({black, white, moves:count, outcome, seconds:{black:+(elapsed.black/1000).toFixed(2),white:+(elapsed.white/1000).toFixed(2)}}));
}
