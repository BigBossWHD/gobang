// 独立规则检查：不调用被测 AI 的棋型评分、候选筛选或威胁搜索。
function hasFive(board, x, y, player) {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let count = 1;
        for (const sign of [-1, 1]) {
            for (let step = 1; step < board.length; step++) {
                if (board[x + sign * dx * step]?.[y + sign * dy * step] !== player) break;
                count++;
            }
        }
        if (count >= 5) return true;
    }
    return false;
}
function emptyCells(board) {
    return board.flatMap((row, x) => row.flatMap((cell, y) => cell === null ? [{ x, y }] : []));
}
function winningCells(board, player) {
    const result = [];
    for (const move of emptyCells(board)) {
        board[move.x][move.y] = player;
        if (hasFive(board, move.x, move.y, player)) result.push(move);
        board[move.x][move.y] = null;
    }
    return result;
}
// AND 节点穷举全部合法防守；OR 节点只需证书提供一种可行胜法。
function verifyThreatProof(board, attacker, first, attackCells, depth) {
    const defender = attacker === 'black' ? 'white' : 'black';
    const unique = [...new Map(attackCells.map(move => [`${move.x},${move.y}`, move])).values()];
    function attack(remaining, forced = null) {
        if (remaining <= 0) return false;
        for (const move of forced ? [forced] : unique) {
            if (board[move.x]?.[move.y] !== null) continue;
            board[move.x][move.y] = attacker;
            try {
                if (hasFive(board, move.x, move.y, attacker)) return true;
                if (winningCells(board, defender).length) continue;
                const wins = winningCells(board, attacker);
                if (wins.length >= 2) return true;
                const replies = wins.length === 1 ? wins : emptyCells(board);
                let proven = true;
                for (const reply of replies) {
                    board[reply.x][reply.y] = defender;
                    try {
                        if (!attack(remaining - 1)) { proven = false; break; }
                    } finally { board[reply.x][reply.y] = null; }
                }
                if (proven) return true;
            } finally { board[move.x][move.y] = null; }
        }
        return false;
    }
    return attack(depth, first);
}
module.exports = { hasFive, emptyCells, winningCells, verifyThreatProof };
