// 五子棋游戏逻辑
class GomokuGame {
    constructor() {
        this.boardSize = 15;
        this.board = [];
        this.currentPlayer = 'black'; // 黑棋先行
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = []; // 悔棋历史
        this.gameMode = 'pvp'; // 'pvp' 或 'pve'
        this.difficulty = 'medium'; // 'easy', 'medium', 'hard'
        this.lastMoveCell = null; // 记录最近一次落子的DOM节点
        this.playerRole = 'first'; // 'first' 或 'second'
        this.humanPlayer = null; // 当前玩家身份
        this.aiPlayer = null; // 当前AI身份
        this.aiTimeoutId = null; // 记录AI延迟
        this.resultModal = null;
        this.resultModalMessage = null;
        this.resultModalTitle = null;
        
        this.updatePlayerColors();
        
        // 初始化棋盘
        this.initializeBoard();
        
        // 绑定事件
        this.bindEvents();
        
        // 渲染棋盘
        this.renderBoard();
        
        this.initModal();
        // 初始化设置面板事件
        this.initSettingsPanel();
    }
    
    initializeBoard() {
        // 创建15x15的空棋盘
        for (let i = 0; i < this.boardSize; i++) {
            this.board[i] = [];
            for (let j = 0; j < this.boardSize; j++) {
                this.board[i][j] = null;
            }
        }
    }
    
    bindEvents() {
        // 新游戏按钮
        document.getElementById('new-game').addEventListener('click', () => {
            this.newGame();
        });

        // 悔棋按钮
        document.getElementById('undo-button').addEventListener('click', () => {
            this.undoMove();
        });
        
        // 棋盘点击事件
        const gameBoard = document.getElementById('game-board');
        gameBoard.addEventListener('click', (e) => {
            if (this.gameOver) return;
            
            // 如果是人机对战且当前是AI回合，则不响应点击
            if (this.gameMode === 'pve' && this.currentPlayer !== this.humanPlayer) return;
            
            // 找到被点击的格子
            const cell = e.target.closest('.game-board-cell');
            if (!cell) return;
            
            const x = parseInt(cell.dataset.x);
            const y = parseInt(cell.dataset.y);
            
            this.makeMove(x, y);
        });
    }
    
    makeMove(x, y) {
        // 检查位置是否为空
        if (this.board[x][y] !== null) {
            return false;
        }
        
        // 放置棋子
        this.board[x][y] = this.currentPlayer;
        this.moveHistory.push({ x, y, player: this.currentPlayer });
        
        // 渲染棋子
        this.renderMove(x, y);
        this.highlightLastMove(x, y);

        const message = document.getElementById('message');
        
        // 检查是否获胜
        if (this.checkWin(x, y)) {
            this.gameOver = true;
            this.winner = this.currentPlayer;
            const winnerName = this.currentPlayer === 'black' ? '黑棋' : '白棋';
            const victoryText = `${winnerName} 获胜！`;
            message.textContent = victoryText;

            let modalDescription = '和对手再来一局吧。';
            if (this.gameMode === 'pve') {
                if (this.humanPlayer && this.currentPlayer === this.humanPlayer) {
                    modalDescription = '恭喜战胜 AI！继续挑战更高难度吧。';
                } else {
                    modalDescription = 'AI 胜出，再接再厉！';
                }
            }

            this.showResultModal(victoryText, modalDescription);
            this.updateStatus();
            return true;
        }
        
        // 检查是否平局
        if (this.isBoardFull()) {
            this.gameOver = true;
            message.textContent = '平局！';
            const modalDescription = this.gameMode === 'pve' ? '势均力敌，再试一次吧。' : '旗鼓相当，下局分高下。';
            this.showResultModal('平局！', modalDescription);
            this.updateStatus();
            return true;
        }
        
        // 切换玩家
        this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
        this.updateStatus();
        
        // 如果是人机对战且轮到AI，则AI落子
        if (this.gameMode === 'pve' && this.currentPlayer === this.aiPlayer && !this.gameOver) {
            this.scheduleAIMove();
        }
        
        return true;
    }

    renderMove(x, y) {
        const cell = document.querySelector(`.game-board-cell[data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.classList.add(this.currentPlayer);
        }
    }
    
    renderBoard() {
        const gameBoard = document.getElementById('game-board');
        gameBoard.innerHTML = '';
        
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = document.createElement('div');
                cell.className = 'game-board-cell';
                cell.dataset.x = i;
                cell.dataset.y = j;
                
                // 添加网格线效果（通过CSS实现）
                gameBoard.appendChild(cell);
            }
        }
        
        this.updateStatus();
    }
    
    updateStatus() {
        const status = document.getElementById('status');
        status.textContent = this.gameOver ? '游戏结束' : 
            `${this.currentPlayer === 'black' ? '黑棋' : '白棋'} 行棋`;
    }
    
    checkWin(x, y) {
        const player = this.board[x][y];
        const directions = [
            [1, 0],   // 水平
            [0, 1],   // 垂直
            [1, 1],   // 对角线 \
            [1, -1]   // 对角线 /
        ];
        
        for (let [dx, dy] of directions) {
            let count = 1; // 包含当前棋子
            
            // 向一个方向检查
            count += this.countDirection(x, y, dx, dy, player);
            
            // 向相反方向检查
            count += this.countDirection(x, y, -dx, -dy, player);
            
            if (count >= 5) {
                return true;
            }
        }
        
        return false;
    }
    
    countDirection(x, y, dx, dy, player) {
        let count = 0;
        let cx = x + dx;
        let cy = y + dy;
        
        while (cx >= 0 && cx < this.boardSize && cy >= 0 && cy < this.boardSize) {
            if (this.board[cx][cy] === player) {
                count++;
                cx += dx;
                cy += dy;
            } else {
                break;
            }
        }
        
        return count;
    }
    
    isBoardFull() {
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (this.board[i][j] === null) {
                    return false;
                }
            }
        }
        return true;
    }
    
    undoMove() {
        this.cancelScheduledAIMove();
        this.hideResultModal();

        if (this.moveHistory.length === 0) {
            if (this.gameMode === 'pve' && this.currentPlayer === this.aiPlayer && !this.gameOver) {
                this.scheduleAIMove(400);
            }
            return; // 没有棋可悔
        }

        const lastMove = this.moveHistory.pop();
        const { x, y } = lastMove;

        // 清除棋盘数据
        this.board[x][y] = null;

        // 恢复游戏状态
        this.gameOver = false;
        this.winner = null;
        this.currentPlayer = lastMove.player;

        // 更新UI
        const cell = document.querySelector(`.game-board-cell[data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.classList.remove('black', 'white');
        }
        
        this.clearLastMoveHighlight();
        if (this.moveHistory.length > 0) {
            const previousMove = this.moveHistory[this.moveHistory.length - 1];
            this.highlightLastMove(previousMove.x, previousMove.y);
        }
        
        const message = document.getElementById('message');
        message.textContent = '';

        this.updateStatus();

        if (this.gameMode === 'pve' && this.currentPlayer === this.aiPlayer && !this.gameOver) {
            this.scheduleAIMove(400);
        }
    }
    
    newGame() {
        this.hideResultModal();
        this.cancelScheduledAIMove();
        this.initializeBoard();
        this.updatePlayerColors();
        this.currentPlayer = 'black';
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = [];

        const message = document.getElementById('message');
        message.textContent = '';

        this.clearLastMoveHighlight();
        this.renderBoard();

        if (this.gameMode === 'pve' && this.currentPlayer === this.aiPlayer && !this.gameOver) {
            this.scheduleAIMove(400);
        }
    }

    clearLastMoveHighlight() {
        if (this.lastMoveCell) {
            this.lastMoveCell.classList.remove('last-move');
            this.lastMoveCell = null;
        }
    }

    highlightLastMove(x, y) {
        this.clearLastMoveHighlight();
        const cell = document.querySelector(`.game-board-cell[data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.classList.add('last-move');
            this.lastMoveCell = cell;
        }
    }

    // 初始化设置面板事件
    initSettingsPanel() {
        // 初始化时根据游戏模式显示/隐藏难度与顺序选择
        this.toggleDifficultySetting();

        const gameModeSelect = document.getElementById('game-mode');
        const difficultySelect = document.getElementById('difficulty');
        const playerRoleSelect = document.getElementById('player-role');

        gameModeSelect.value = this.gameMode;
        difficultySelect.value = this.difficulty;
        playerRoleSelect.value = this.playerRole;

        gameModeSelect.addEventListener('change', (e) => {
            this.gameMode = e.target.value;
            this.toggleDifficultySetting();
            this.updatePlayerColors();
            this.newGame();
        });

        difficultySelect.addEventListener('change', (e) => {
            this.difficulty = e.target.value;
        });

        playerRoleSelect.addEventListener('change', (e) => {
            this.playerRole = e.target.value;
            if (this.gameMode === 'pve') {
                this.updatePlayerColors();
                this.newGame();
            }
        });
    }

    // 切换难度设置的显示/隐藏
    toggleDifficultySetting() {
        const difficultyGroup = document.getElementById('difficulty-group');
        const roleGroup = document.getElementById('player-role-group');
        if (this.gameMode === 'pve') {
            difficultyGroup.classList.remove('hidden');
            roleGroup.classList.remove('hidden');
        } else {
            difficultyGroup.classList.add('hidden');
            roleGroup.classList.add('hidden');
        }
    }

    initModal() {
        this.resultModal = document.getElementById('result-modal');
        this.resultModalMessage = document.getElementById('result-modal-message');
        this.resultModalTitle = document.getElementById('result-modal-title');

        const modalNewGame = document.getElementById('modal-new-game');
        const modalClose = document.getElementById('modal-close');

        if (modalNewGame) {
            modalNewGame.addEventListener('click', () => {
                this.hideResultModal();
                this.newGame();
            });
        }

        if (modalClose) {
            modalClose.addEventListener('click', () => {
                this.hideResultModal();
            });
        }

        this.hideResultModal();
    }

    showResultModal(title, description = '') {
        if (!this.resultModal) {
            return;
        }
        if (this.resultModalTitle) {
            this.resultModalTitle.textContent = title;
        }
        if (this.resultModalMessage) {
            this.resultModalMessage.textContent = description;
        }
        this.resultModal.classList.add('visible');
    }

    hideResultModal() {
        if (this.resultModal) {
            this.resultModal.classList.remove('visible');
        }
    }

    updatePlayerColors() {
        if (this.gameMode === 'pve') {
            if (this.playerRole === 'first') {
                this.humanPlayer = 'black';
                this.aiPlayer = 'white';
            } else {
                this.humanPlayer = 'white';
                this.aiPlayer = 'black';
            }
        } else {
            this.humanPlayer = null;
            this.aiPlayer = null;
        }
    }

    scheduleAIMove(delay = 300) {
        if (this.aiTimeoutId) {
            clearTimeout(this.aiTimeoutId);
        }
        this.aiTimeoutId = setTimeout(() => {
            this.aiTimeoutId = null;
            this.makeAIMove();
        }, delay);
    }

    cancelScheduledAIMove() {
        if (this.aiTimeoutId) {
            clearTimeout(this.aiTimeoutId);
            this.aiTimeoutId = null;
        }
    }

    getOpponent(player) {
        return player === 'black' ? 'white' : 'black';
    }

    // AI落子
    makeAIMove() {
        if (this.gameOver || this.gameMode !== 'pve' || this.currentPlayer !== this.aiPlayer) return;
        
        const aiPlayer = this.aiPlayer;
        let move;
        switch (this.difficulty) {
            case 'easy':
                move = this.getEasyMove(aiPlayer);
                break;
            case 'medium':
                move = this.getMediumMove(aiPlayer);
                break;
            case 'hard':
                move = this.getHardMove(aiPlayer);
                break;
            default:
                move = this.getMediumMove(aiPlayer);
        }
        
        if (move) {
            this.makeMove(move.x, move.y);
        }
    }
    
    // 简单难度AI：基础启发式 + 随机
    getEasyMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        const candidates = this.getCandidateMoves(1);
        if (candidates.length === 0) {
            return null;
        }

        // 先检查是否有直接获胜的机会
        for (const { x, y } of candidates) {
            this.board[x][y] = aiPlayer;
            const isWinningMove = this.checkWin(x, y);
            this.board[x][y] = null;
            if (isWinningMove) {
                return { x, y };
            }
        }

        const blockingMoves = [];

        // 其次检查是否需要立即防守
        for (const { x, y } of candidates) {
            this.board[x][y] = opponent;
            const needsBlock = this.checkWin(x, y);
            this.board[x][y] = null;
            if (needsBlock) {
                blockingMoves.push({ x, y });
            }
        }

        if (blockingMoves.length > 0) {
            const index = Math.floor(Math.random() * blockingMoves.length);
            return blockingMoves[index];
        }

        let bestScore = -Infinity;
        const topMoves = [];

        for (const { x, y } of candidates) {
            const offensiveScore = this.evaluatePosition(x, y, aiPlayer);
            const defensiveScore = this.evaluatePosition(x, y, opponent);
            const adjacency = this.countAdjacentStones(x, y);
            const score = this.centerBias(x, y, 30) + offensiveScore * 0.8 + defensiveScore * 0.25 + adjacency * 40 - Math.random() * 15;

            if (score > bestScore + 5) {
                bestScore = score;
                topMoves.length = 0;
                topMoves.push({ x, y, score });
            } else if (Math.abs(score - bestScore) <= 5) {
                topMoves.push({ x, y, score });
            }
        }

        if (topMoves.length === 0) {
            const index = Math.floor(Math.random() * candidates.length);
            return candidates[index];
        }

        const selection = topMoves[Math.floor(Math.random() * topMoves.length)];
        return { x: selection.x, y: selection.y };
    }

    // 中等难度AI：基于评分机制
    getMediumMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        let bestScore = -Infinity;
        let bestMove = null;
        
        // 检查是否有获胜或防守的机会
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (this.board[i][j] === null) {
                    // 尝试放置AI棋子
                    this.board[i][j] = aiPlayer;
                    if (this.checkWin(i, j)) {
                        this.board[i][j] = null;
                        return { x: i, y: j };
                    }
                    this.board[i][j] = null;
                    
                    // 尝试放置对手棋子（防守）
                    this.board[i][j] = opponent;
                    if (this.checkWin(i, j)) {
                        this.board[i][j] = null;
                        return { x: i, y: j };
                    }
                    this.board[i][j] = null;
                }
            }
        }
        
        // 否则基于评分选择最佳位置
        let candidates = this.getCandidateMoves(2);
        if (candidates.length < 6) {
            const expanded = this.getCandidateMoves(3);
            const seen = new Set(candidates.map(({ x, y }) => `${x},${y}`));
            for (const move of expanded) {
                const key = `${move.x},${move.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    candidates.push(move);
                }
            }
        }

        for (const { x, y } of candidates) {
            const aggressiveScore = this.evaluateAdvancedPositionForPlayer(x, y, aiPlayer, {
                centerWeight: 42,
                offensiveMultiplier: 1.2,
                defensiveMultiplier: 0.35,
                adjacencyWeight: 55,
                adjacencyRadius: 2,
                threatWeight: 0.85
            });
            const safetyScore = this.evaluateAdvancedPositionForPlayer(x, y, opponent, {
                centerWeight: 30,
                offensiveMultiplier: 1.05,
                defensiveMultiplier: 0.5,
                adjacencyWeight: 30,
                adjacencyRadius: 2,
                threatWeight: 0.7
            });
            const adjacency = this.countAdjacentStones(x, y);
            const score = aggressiveScore + safetyScore * 0.5 + adjacency * 18 - Math.random() * 6;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { x, y };
            }
        }

        // 如果没有找到好的位置，使用简单策略
        if (!bestMove) {
            return this.getEasyMove(aiPlayer);
        }
        
        return bestMove;
    }

    // 困难难度AI：更复杂的评分和搜索
    getHardMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        let bestScore = -Infinity;
        let bestMove = null;
        
        // 检查是否有获胜的机会
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (this.board[i][j] === null) {
                    this.board[i][j] = aiPlayer;
                    if (this.checkWin(i, j)) {
                        this.board[i][j] = null;
                        return { x: i, y: j };
                    }
                    this.board[i][j] = null;
                }
            }
        }
        
        // 检查是否需要防守
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (this.board[i][j] === null) {
                    this.board[i][j] = opponent;
                    if (this.checkWin(i, j)) {
                        this.board[i][j] = null;
                        return { x: i, y: j };
                    }
                    this.board[i][j] = null;
                }
            }
        }
        
        // 使用更深的评分和浅层搜索
        let candidates = this.getCandidateMoves(2);
        if (candidates.length < 8) {
            const expanded = this.getCandidateMoves(3);
            const seen = new Set(candidates.map(({ x, y }) => `${x},${y}`));
            for (const move of expanded) {
                const key = `${move.x},${move.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    candidates.push(move);
                }
            }
        }

        const scoredCandidates = candidates
            .map(({ x, y }) => ({
                x,
                y,
                baseScore: this.evaluateAdvancedPosition(x, y, aiPlayer)
            }))
            .sort((a, b) => b.baseScore - a.baseScore);

        const searchDepth = 2;
        const limit = Math.min(8, scoredCandidates.length);

        for (let index = 0; index < limit; index++) {
            const { x, y, baseScore } = scoredCandidates[index];
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = aiPlayer;
            const immediateWin = this.checkWin(x, y);
            let lookaheadScore;
            if (immediateWin) {
                this.board[x][y] = null;
                return { x, y };
            }

            lookaheadScore = this.minimaxSearch(searchDepth, -Infinity, Infinity, opponent, aiPlayer, searchDepth);
            this.board[x][y] = null;

            const effectiveLookahead = Number.isFinite(lookaheadScore) ? lookaheadScore : 0;
            const totalScore = effectiveLookahead + baseScore * 0.08;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestMove = { x, y };
            }
        }

        // 如果没有找到好的位置，使用中等难度策略
        if (!bestMove) {
            return this.getMediumMove(aiPlayer);
        }

        return bestMove;
    }

    getCandidateMoves(radius = 1) {
        const candidates = [];
        let hasPieces = this.moveHistory.length > 0;

        if (!hasPieces) {
            for (let i = 0; i < this.boardSize && !hasPieces; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    if (this.board[i][j] !== null) {
                        hasPieces = true;
                        break;
                    }
                }
            }
        }

        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                if (this.board[i][j] !== null) continue;

                if (!hasPieces) {
                    continue;
                }

                if (this.hasNeighborWithinRadius(i, j, radius)) {
                    candidates.push({ x: i, y: j });
                }
            }
        }

        if (candidates.length === 0) {
            const center = Math.floor(this.boardSize / 2);
            if (this.board[center][center] === null) {
                candidates.push({ x: center, y: center });
            }
        }

        return candidates;
    }

    hasNeighborWithinRadius(x, y, radius) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (!this.isInsideBoard(nx, ny)) continue;
                if (this.board[nx][ny] !== null) {
                    return true;
                }
            }
        }
        return false;
    }

    countAdjacentStones(x, y, radius = 1) {
        let count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (!this.isInsideBoard(nx, ny)) continue;
                if (this.board[nx][ny] !== null) {
                    count++;
                }
            }
        }
        return count;
    }

    centerBias(x, y, weight = 50) {
        const center = Math.floor(this.boardSize / 2);
        const distance = Math.abs(x - center) + Math.abs(y - center);
        const bias = weight - distance * 8;
        return bias > 0 ? bias : 0;
    }

    estimateOpponentBestScore(radius = 2) {
        if (!this.aiPlayer) {
            return 0;
        }
        const opponent = this.getOpponent(this.aiPlayer);
        return this.estimateBestScoreForPlayer(opponent, radius);
    }

    estimateBestScoreForPlayer(player, radius = 2, options = {}) {
        const candidateMoves = this.getCandidateMoves(radius);
        let bestScore = -Infinity;

        for (const { x, y } of candidateMoves) {
            if (this.board[x][y] !== null) continue;
            const score = this.evaluateAdvancedPositionForPlayer(x, y, player, options);
            if (score > bestScore) {
                bestScore = score;
            }
        }

        if (bestScore === -Infinity) {
            return 0;
        }

        return bestScore;
    }

    evaluateBoardAdvantage(aiPlayer = this.aiPlayer || 'white') {
        const opponent = this.getOpponent(aiPlayer);
        const aiScore = this.estimateBestScoreForPlayer(aiPlayer, 2, {
            centerWeight: 45,
            offensiveMultiplier: 1.3,
            defensiveMultiplier: 0.45,
            adjacencyWeight: 60,
            adjacencyRadius: 2,
            threatWeight: 0.95
        });
        const opponentScore = this.estimateBestScoreForPlayer(opponent, 2, {
            centerWeight: 45,
            offensiveMultiplier: 1.25,
            defensiveMultiplier: 0.5,
            adjacencyWeight: 55,
            adjacencyRadius: 2,
            threatWeight: 0.9
        });
        return aiScore - opponentScore * 0.95;
    }

    minimaxSearch(depth, alpha, beta, currentPlayer, aiPlayer, initialDepth = depth) {
        if (depth === 0 || this.isBoardFull()) {
            return this.evaluateBoardAdvantage(aiPlayer);
        }

        const maximizingPlayer = currentPlayer === aiPlayer;
        let candidates = this.getCandidateMoves(2);

        if (candidates.length === 0) {
            return this.evaluateBoardAdvantage(aiPlayer);
        }

        const orderingWeights = maximizingPlayer
            ? {
                centerWeight: 50,
                offensiveMultiplier: 1.35,
                defensiveMultiplier: 0.45,
                adjacencyWeight: 70,
                adjacencyRadius: 2,
                threatWeight: 1
            }
            : {
                centerWeight: 48,
                offensiveMultiplier: 1.3,
                defensiveMultiplier: 0.55,
                adjacencyWeight: 60,
                adjacencyRadius: 2,
                threatWeight: 0.95
            };

        const orderedMoves = candidates
            .map(({ x, y }) => ({
                x,
                y,
                score: this.evaluateAdvancedPositionForPlayer(x, y, currentPlayer, orderingWeights)
            }))
            .sort((a, b) => maximizingPlayer ? b.score - a.score : a.score - b.score);

        const moveLimit = Math.min(depth === initialDepth ? 10 : 6, orderedMoves.length);
        if (moveLimit === 0) {
            return this.evaluateBoardAdvantage(aiPlayer);
        }

        let bestValue = maximizingPlayer ? -Infinity : Infinity;
        const opponent = this.getOpponent(currentPlayer);

        for (let i = 0; i < moveLimit; i++) {
            const { x, y } = orderedMoves[i];
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = currentPlayer;
            const hasWin = this.checkWin(x, y);
            let nodeValue;

            if (hasWin) {
                nodeValue = currentPlayer === aiPlayer
                    ? 100000 - depth * 500
                    : -100000 + depth * 500;
            } else {
                nodeValue = this.minimaxSearch(depth - 1, alpha, beta, opponent, aiPlayer, initialDepth);
            }

            this.board[x][y] = null;

            if (maximizingPlayer) {
                if (nodeValue > bestValue) {
                    bestValue = nodeValue;
                }
                if (nodeValue > alpha) {
                    alpha = nodeValue;
                }
            } else {
                if (nodeValue < bestValue) {
                    bestValue = nodeValue;
                }
                if (nodeValue < beta) {
                    beta = nodeValue;
                }
            }

            if (beta <= alpha) {
                break;
            }
        }

        if (!Number.isFinite(bestValue)) {
            return this.evaluateBoardAdvantage(aiPlayer);
        }

        return bestValue;
    }

    // 评估位置得分
    evaluatePosition(x, y, player) {
        if (this.board[x][y] !== null) return 0;
        
        this.board[x][y] = player;
        const lineStats = this.collectLineStats(x, y, player);
        const score = lineStats.reduce((total, stats) => total + this.scoreLine(stats.length, stats.openEnds), 0);
        this.board[x][y] = null;
        return score;
    }

    // 高级位置评估
    evaluateAdvancedPosition(x, y, player = this.aiPlayer || 'white') {
        return this.evaluateAdvancedPositionForPlayer(x, y, player);
    }

    evaluateAdvancedPositionForPlayer(x, y, player, options = {}) {
        if (this.board[x][y] !== null) return 0;

        const opponent = player === 'white' ? 'black' : 'white';
        const {
            centerWeight = 50,
            offensiveMultiplier = 1.35,
            defensiveMultiplier = 0.55,
            adjacencyWeight = 75,
            adjacencyRadius = 1,
            threatWeight = 1
        } = options;

        let score = this.centerBias(x, y, centerWeight);

        const offensiveScore = this.evaluatePosition(x, y, player);
        const defensiveScore = this.evaluatePosition(x, y, opponent);

        this.board[x][y] = player;
        const offensiveStats = this.collectLineStats(x, y, player);
        this.board[x][y] = null;

        score += offensiveScore * offensiveMultiplier;
        score += defensiveScore * defensiveMultiplier;
        score += this.countAdjacentStones(x, y, adjacencyRadius) * adjacencyWeight;
        score += this.calculateThreatBonus(offensiveStats) * threatWeight;

        return score;
    }

    calculateThreatBonus(lineStats) {
        const openFours = lineStats.filter(stats => stats.length === 4 && stats.openEnds === 2).length;
        const semiOpenFours = lineStats.filter(stats => stats.length === 4 && stats.openEnds === 1).length;
        const openThrees = lineStats.filter(stats => stats.length === 3 && stats.openEnds === 2).length;
        const semiOpenThrees = lineStats.filter(stats => stats.length === 3 && stats.openEnds === 1).length;
        const openTwos = lineStats.filter(stats => stats.length === 2 && stats.openEnds === 2).length;

        let bonus = 0;

        if (openFours >= 2) {
            bonus += 18000;
        } else if (openFours === 1) {
            bonus += 6000;
        }

        if (semiOpenFours >= 2) {
            bonus += 2200;
        } else if (semiOpenFours === 1) {
            bonus += 1400;
        }

        if (openFours >= 1 && openThrees >= 1) {
            bonus += 3200;
        }

        if (openThrees >= 2) {
            bonus += 5000;
        } else if (openThrees === 1) {
            bonus += 1600;
        }

        if (semiOpenThrees >= 2) {
            bonus += 700;
        } else if (semiOpenThrees === 1) {
            bonus += 350;
        }

        if (openThrees >= 1 && semiOpenThrees >= 1) {
            bonus += 900;
        }

        if (openTwos > 0) {
            bonus += 150 * openTwos;
        }

        return bonus;
    }

    collectLineStats(x, y, player) {
        const directions = [
            [1, 0],   // 水平
            [0, 1],   // 垂直
            [1, 1],   // 对角线 \
            [1, -1]   // 对角线 /
        ];

        return directions.map(([dx, dy]) => this.getLineStats(x, y, dx, dy, player));
    }

    getLineStats(x, y, dx, dy, player) {
        let length = 1;
        let openEnds = 0;

        let cx = x + dx;
        let cy = y + dy;
        while (this.isInsideBoard(cx, cy)) {
            const cell = this.board[cx][cy];
            if (cell === player) {
                length++;
                cx += dx;
                cy += dy;
            } else {
                if (cell === null) {
                    openEnds++;
                }
                break;
            }
        }

        cx = x - dx;
        cy = y - dy;
        while (this.isInsideBoard(cx, cy)) {
            const cell = this.board[cx][cy];
            if (cell === player) {
                length++;
                cx -= dx;
                cy -= dy;
            } else {
                if (cell === null) {
                    openEnds++;
                }
                break;
            }
        }

        return { length, openEnds };
    }

    scoreLine(length, openEnds) {
        if (length >= 5) return 100000;
        if (length === 4) {
            if (openEnds === 2) return 15000;
            if (openEnds === 1) return 6000;
            return 100;
        }
        if (length === 3) {
            if (openEnds === 2) return 2000;
            if (openEnds === 1) return 400;
            return 20;
        }
        if (length === 2) {
            if (openEnds === 2) return 300;
            if (openEnds === 1) return 60;
            return 5;
        }
        if (length === 1) {
            if (openEnds === 2) return 40;
            if (openEnds === 1) return 15;
            return 2;
        }
        return 0;
    }

    isInsideBoard(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }
}

// 游戏初始化
document.addEventListener('DOMContentLoaded', () => {
    const game = new GomokuGame();
});
