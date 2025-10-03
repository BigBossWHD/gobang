// 五子棋游戏逻辑
class GomokuGame {
    constructor() {
        this.boardSize = 15;
        this.board = [];
        this.currentPlayer = 'black'; // 黑棋先行
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = []; // 悔棋历史
        this.gameMode = 'pve'; // 默认人机对战
        this.difficulty = 'hard'; // 默认困难
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
            return; // 没有棋可悔
        }

        const revertLastMove = () => {
            const move = this.moveHistory.pop();
            if (!move) {
                return null;
            }
            this.revertSingleMove(move);
            return move;
        };

        const lastMove = revertLastMove();
        if (!lastMove) {
            return;
        }

        // 恢复游戏状态
        this.gameOver = false;
        this.winner = null;

        if (this.gameMode === 'pve' && lastMove.player === this.aiPlayer && this.moveHistory.length > 0) {
            const previousMove = this.moveHistory[this.moveHistory.length - 1];
            if (previousMove.player === this.humanPlayer) {
                revertLastMove();
                this.currentPlayer = this.humanPlayer;
            } else {
                this.currentPlayer = lastMove.player;
            }
        } else {
            this.currentPlayer = lastMove.player;
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

    revertSingleMove(move) {
        if (!move) {
            return;
        }
        const { x, y } = move;
        this.board[x][y] = null;
        const cell = document.querySelector(`.game-board-cell[data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.classList.remove('black', 'white', 'last-move');
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
            const newDifficulty = e.target.value;
            if (newDifficulty === this.difficulty) {
                return;
            }

            const previousDifficulty = this.difficulty;
            const hasProgress = this.moveHistory.length > 0;
            let shouldRestart = true;

            if (hasProgress) {
                shouldRestart = window.confirm('切换难度会重新开始本局，是否继续？');
            }

            if (shouldRestart) {
                this.difficulty = newDifficulty;
                this.newGame();
            } else {
                e.target.value = previousDifficulty;
            }
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

    // 从高分候选中按权重随机选择，避免每局完全固定
    selectRandomizedMove(candidates, options = {}) {
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return null;
        }

        const {
            topN = 3,
            temperature = 1.0
        } = options;

        if (temperature <= 0) {
            return candidates[0];
        }

        const limit = Math.max(1, Math.min(topN, candidates.length));
        const pool = candidates.slice(0, limit);

        let maxScore = -Infinity;
        let minScore = Infinity;
        for (const move of pool) {
            if (move.score > maxScore) {
                maxScore = move.score;
            }
            if (move.score < minScore) {
                minScore = move.score;
            }
        }

        const span = maxScore - minScore;
        const safeSpan = span === 0 ? 1 : span;
        const weights = pool.map((move, index) => {
            const normalizedScore = (move.score - minScore) / safeSpan;
            const rankFactor = (pool.length - index) / pool.length;
            const base = normalizedScore * 0.7 + rankFactor * 0.3 + 0.05;
            const adjusted = Math.pow(base, 1 / Math.max(temperature, 0.05));
            return adjusted;
        });

        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = Math.random() * totalWeight;
        for (let i = 0; i < pool.length; i++) {
            roll -= weights[i];
            if (roll <= 0) {
                return pool[i];
            }
        }

        return pool[pool.length - 1];
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

        const urgentDefense = this.findCriticalDefenseMove(opponent, 6800, 2);
        if (urgentDefense) {
            return urgentDefense;
        }

        const scoredMoves = candidates
            .map(({ x, y }) => {
                const evaluation = this.evaluateAdvancedPositionForPlayer(x, y, aiPlayer, {
                    centerWeight: 32,
                    offensiveMultiplier: 0.9,
                    defensiveMultiplier: 0.45,
                    adjacencyWeight: 36,
                    adjacencyRadius: 1,
                    threatWeight: 0.6,
                    forkWeight: 0.45,
                    defensiveThreatWeight: 0.35,
                    defensiveForkWeight: 0.3
                });
                const noise = Math.random() * 36;
                return { x, y, score: evaluation + noise };
            })
            .sort((a, b) => b.score - a.score);

        if (scoredMoves.length === 0) {
            const index = Math.floor(Math.random() * candidates.length);
            return candidates[index];
        }

        const selection = this.selectRandomizedMove(scoredMoves, {
            topN: Math.min(6, scoredMoves.length),
            temperature: 1.4
        });

        if (selection) {
            return { x: selection.x, y: selection.y };
        }

        const index = Math.floor(Math.random() * scoredMoves.length);
        return { x: scoredMoves[index].x, y: scoredMoves[index].y };
    }

    // 中等难度AI：基于评分机制
    getMediumMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        const scoredMoves = [];
        
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
        
        const criticalDefense = this.findCriticalDefenseMove(opponent, 6200);
        if (criticalDefense) {
            return criticalDefense;
        }

        const forcingAttack = this.findForcingAttack(aiPlayer, 8800);
        if (forcingAttack) {
            return forcingAttack;
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
                centerWeight: 44,
                offensiveMultiplier: 1.32,
                defensiveMultiplier: 0.45,
                adjacencyWeight: 60,
                adjacencyRadius: 2,
                threatWeight: 1.05,
                forkWeight: 0.9,
                defensiveThreatWeight: 0.65,
                defensiveForkWeight: 0.6
            });
            const safetyScore = this.evaluateAdvancedPositionForPlayer(x, y, opponent, {
                centerWeight: 20,
                offensiveMultiplier: 1.08,
                defensiveMultiplier: 0.48,
                adjacencyWeight: 36,
                adjacencyRadius: 2,
                threatWeight: 0.78,
                forkWeight: 0.6,
                defensiveThreatWeight: 0.4,
                defensiveForkWeight: 0.35
            });
            const variability = Math.random() * 24;
            const score = aggressiveScore + safetyScore * 0.55 + variability;
            scoredMoves.push({ x, y, score });
        }

        if (scoredMoves.length === 0) {
            return this.getEasyMove(aiPlayer);
        }

        const orderedMoves = scoredMoves.sort((a, b) => b.score - a.score);
        const selection = this.selectRandomizedMove(orderedMoves, {
            topN: Math.min(5, orderedMoves.length),
            temperature: 0.85
        });

        if (selection) {
            return { x: selection.x, y: selection.y };
        }

        return this.getEasyMove(aiPlayer);
    }

    // 困难难度AI：更复杂的评分和搜索
    getHardMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        let bestScore = -Infinity;
        let bestMove = null;
        const evaluatedMoves = [];
        
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

        const criticalDefense = this.findCriticalDefenseMove(opponent, 5200);
        if (criticalDefense) {
            return criticalDefense;
        }

        const forcingAttack = this.findForcingAttack(aiPlayer, 8600);
        if (forcingAttack) {
            return forcingAttack;
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
            .map(({ x, y }) => {
                const advancedScore = this.evaluateAdvancedPositionForPlayer(x, y, aiPlayer, {
                    centerWeight: 56,
                    offensiveMultiplier: 1.72,
                    defensiveMultiplier: 0.52,
                    adjacencyWeight: 94,
                    adjacencyRadius: 2,
                    threatWeight: 1.45,
                    forkWeight: 1.28,
                    defensiveThreatWeight: 0.7,
                    defensiveForkWeight: 0.62
                });
                const analysis = this.analyzePlacement(x, y, aiPlayer);
                const bonusStats = analysis ? analysis.lineStats : [];
                const pressure = bonusStats.length ? this.calculateOffensivePressure(bonusStats) : 0;
                const chainPotential = bonusStats.length ? this.calculateChainPotential(bonusStats) : 0;
                const priorityScore = pressure * 0.55 + chainPotential * 0.9;
                return {
                    x,
                    y,
                    baseScore: advancedScore + priorityScore
                };
            })
            .sort((a, b) => b.baseScore - a.baseScore);

        const searchDepth = this.moveHistory.length < 12 ? 3 : 2;
        const limit = Math.min(searchDepth === 3 ? 8 : 9, scoredCandidates.length);

        for (let index = 0; index < limit; index++) {
            const { x, y, baseScore } = scoredCandidates[index];
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = aiPlayer;
            const immediateWin = this.checkWin(x, y);
            const offensiveStats = this.collectLineStats(x, y, aiPlayer);
            const offensiveProfile = this.getThreatProfile(offensiveStats);
            const forkBonus = this.calculateForkBonus(offensiveStats);
            const forcingSeverity = this.evaluateOffenseSeverity(offensiveProfile);
            const pressureScore = this.calculateOffensivePressure(offensiveStats);
            const chainPotential = this.calculateChainPotential(offensiveStats);
            const immediateAdvantage = this.evaluateBoardAdvantage(aiPlayer);
            let lookaheadScore;
            if (immediateWin) {
                this.board[x][y] = null;
                return { x, y };
            }

            if (forcingSeverity >= 8700 || forkBonus >= 20000 || pressureScore >= 9000 || chainPotential >= 9500) {
                this.board[x][y] = null;
                return { x, y };
            }

            lookaheadScore = this.minimaxSearch(searchDepth, -Infinity, Infinity, opponent, aiPlayer, searchDepth);
            this.board[x][y] = null;

            const effectiveLookahead = Number.isFinite(lookaheadScore) ? lookaheadScore : 0;
            const totalScore = effectiveLookahead * 0.55
                + baseScore * 0.35
                + forkBonus * 0.008
                + forcingSeverity * 2.2
                + pressureScore * 0.5
                + chainPotential * 0.65
                + immediateAdvantage * 0.45;

            const randomizedScore = totalScore + Math.random() * 120;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestMove = { x, y };
            }

            evaluatedMoves.push({ x, y, score: randomizedScore });
        }

        if (evaluatedMoves.length === 0) {
            return this.getMediumMove(aiPlayer);
        }

        const orderedMoves = evaluatedMoves.sort((a, b) => b.score - a.score);
        const selection = this.selectRandomizedMove(orderedMoves, {
            topN: Math.min(4, orderedMoves.length),
            temperature: 0.6
        });

        if (selection) {
            return { x: selection.x, y: selection.y };
        }

        if (bestMove) {
            return bestMove;
        }

        return this.getMediumMove(aiPlayer);
    }

    findCriticalDefenseMove(opponent, minSeverity = 5000, radius = 3) {
        const candidates = this.getCandidateMoves(radius);
        let bestMove = null;
        let bestSeverity = 0;

        for (const { x, y } of candidates) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = opponent;
            const lineStats = this.collectLineStats(x, y, opponent);
            this.board[x][y] = null;

            const profile = this.getThreatProfile(lineStats);
            const severity = this.evaluateDefenseSeverity(profile);

            if (severity > bestSeverity) {
                bestSeverity = severity;
                bestMove = { x, y };
            }
        }

        if (bestSeverity >= minSeverity) {
            return bestMove;
        }

        return null;
    }

    findForcingAttack(player, minSeverity = 9000, radius = 3) {
        const candidates = this.getCandidateMoves(radius);
        let bestMove = null;
        let bestSeverity = 0;

        for (const { x, y } of candidates) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = player;
            const lineStats = this.collectLineStats(x, y, player);
            const profile = this.getThreatProfile(lineStats);
            const forkBonus = this.calculateForkBonus(lineStats);
            const pressure = this.calculateOffensivePressure(lineStats);
            const severity = Math.max(this.evaluateOffenseSeverity(profile), forkBonus / 3, pressure / 2);
            this.board[x][y] = null;

            if (severity > bestSeverity) {
                bestSeverity = severity;
                bestMove = { x, y };
            }
        }

        if (bestSeverity >= minSeverity) {
            return bestMove;
        }

        return null;
    }

    getCandidateMoves(radius = 1) {
        const candidates = [];
        const seen = new Set();
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

        if (!hasPieces) {
            const center = Math.floor(this.boardSize / 2);
            if (this.board[center][center] === null) {
                candidates.push({ x: center, y: center });
            }
            return candidates;
        }

        const targetSize = Math.max(12, this.moveHistory.length * 2 + 4);
        const maxRadius = Math.min(radius + 2, 4);

        const tryCollect = (currentRadius) => {
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    if (this.board[i][j] !== null) continue;
                    if (!this.hasNeighborWithinRadius(i, j, currentRadius)) continue;
                    const key = `${i},${j}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    candidates.push({ x: i, y: j });
                }
            }
        };

        for (let currentRadius = radius; currentRadius <= maxRadius; currentRadius++) {
            tryCollect(currentRadius);
            if (candidates.length >= targetSize) {
                break;
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
        const aiPressure = this.estimatePressurePotentialForPlayer(aiPlayer, 2);
        const opponentPressure = this.estimatePressurePotentialForPlayer(opponent, 2);
        const pressureDelta = aiPressure - opponentPressure * 0.92;
        return aiScore - opponentScore * 0.95 + pressureDelta * 0.08;
    }

    estimatePressurePotentialForPlayer(player, radius = 2) {
        const candidateMoves = this.getCandidateMoves(radius);
        let bestPressure = 0;

        for (const { x, y } of candidateMoves) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = player;
            const lineStats = this.collectLineStats(x, y, player);
            const pressure = this.calculateOffensivePressure(lineStats);
            const chainPotential = this.calculateChainPotential(lineStats);
            this.board[x][y] = null;

            const combined = pressure + chainPotential * 0.75;
            if (combined > bestPressure) {
                bestPressure = combined;
            }
        }

        return bestPressure;
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
                threatWeight: 1,
                forkWeight: 1.05,
                defensiveThreatWeight: 0.7,
                defensiveForkWeight: 0.65
            }
            : {
                centerWeight: 48,
                offensiveMultiplier: 1.3,
                defensiveMultiplier: 0.55,
                adjacencyWeight: 60,
                adjacencyRadius: 2,
                threatWeight: 0.95,
                forkWeight: 0.95,
                defensiveThreatWeight: 0.75,
                defensiveForkWeight: 0.7
            };

        const orderedMoves = candidates
            .map(({ x, y }) => ({
                x,
                y,
                score: this.evaluateAdvancedPositionForPlayer(x, y, currentPlayer, orderingWeights)
            }))
            .sort((a, b) => maximizingPlayer ? b.score - a.score : a.score - b.score);

        const primaryWidth = initialDepth >= 3 ? 7 : 10;
        const secondaryWidth = initialDepth >= 3 ? 5 : 6;
        const moveLimit = Math.min(depth === initialDepth ? primaryWidth : secondaryWidth, orderedMoves.length);
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

    analyzePlacement(x, y, player) {
        if (this.board[x][y] !== null) {
            return null;
        }

        this.board[x][y] = player;
        const lineStats = this.collectLineStats(x, y, player);
        const score = lineStats.reduce((total, stats) => total + this.scoreLine(stats.length, stats.openEnds), 0);
        this.board[x][y] = null;

        return { score, lineStats };
    }

    // 评估位置得分
    evaluatePosition(x, y, player) {
        const analysis = this.analyzePlacement(x, y, player);
        return analysis ? analysis.score : 0;
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
            threatWeight = 1,
            forkWeight = 1,
            defensiveThreatWeight = 0.6,
            defensiveForkWeight = 0.55
        } = options;

        const offensiveAnalysis = this.analyzePlacement(x, y, player);
        if (!offensiveAnalysis) {
            return 0;
        }

        const defensiveAnalysis = this.analyzePlacement(x, y, opponent);

        let score = this.centerBias(x, y, centerWeight);

        const { score: offensiveScore, lineStats: offensiveStats } = offensiveAnalysis;
        const defensiveScore = defensiveAnalysis ? defensiveAnalysis.score : 0;

        score += offensiveScore * offensiveMultiplier;
        score += defensiveScore * defensiveMultiplier;
        score += this.countAdjacentStones(x, y, adjacencyRadius) * adjacencyWeight;
        score += this.calculateThreatBonus(offensiveStats) * threatWeight;
        score += this.calculateForkBonus(offensiveStats) * forkWeight;

        if (defensiveAnalysis) {
            score += this.calculateThreatBonus(defensiveAnalysis.lineStats) * defensiveThreatWeight;
            score += this.calculateForkBonus(defensiveAnalysis.lineStats) * defensiveForkWeight;
        }

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

    calculateForkBonus(lineStats) {
        const profile = this.getThreatProfile(lineStats);
        const { openFours, semiOpenFours, openThrees, semiOpenThrees } = profile;
        let bonus = 0;

        if (openFours >= 2) {
            bonus += 26000;
        } else if (openFours === 1 && (openThrees >= 1 || semiOpenFours >= 1)) {
            bonus += 12000;
        }

        if (semiOpenFours >= 2) {
            bonus += 4200;
        } else if (semiOpenFours === 1 && openThrees >= 1) {
            bonus += 3200;
        }

        if (openThrees >= 2) {
            bonus += 6500;
        } else if (openThrees === 1 && semiOpenThrees >= 1) {
            bonus += 2200;
        }

        if (semiOpenThrees >= 2) {
            bonus += 1100;
        }

        if (openFours >= 1 && semiOpenThrees >= 1) {
            bonus += 1800;
        }

        return bonus;
    }

    calculateOffensivePressure(lineStats) {
        const profile = this.getThreatProfile(lineStats);
        const { openFours, semiOpenFours, openThrees, semiOpenThrees } = profile;
        let pressure = 0;

        pressure += openFours * 8500;
        if (openFours >= 2) {
            pressure += 2600;
        }

        pressure += semiOpenFours * 3600;
        if (semiOpenFours >= 2) {
            pressure += 1800;
        }

        pressure += openThrees * 2600;
        pressure += semiOpenThrees * 1500;

        if (openThrees >= 1 && semiOpenThrees >= 1) {
            pressure += 900;
        }

        const extendableFours = lineStats.filter(stats => stats.length === 4 && stats.openEnds === 1).length;
        pressure += extendableFours * 2000;

        const richThrees = lineStats.filter(stats => stats.length === 3 && stats.openEnds === 2).length;
        if (richThrees >= 2) {
            pressure += 2200;
        }

        return pressure;
    }

    calculateChainPotential(lineStats) {
        const profile = this.getThreatProfile(lineStats);
        const { openFours, semiOpenFours, openThrees, semiOpenThrees } = profile;
        let potential = 0;

        for (const stats of lineStats) {
            if (stats.length === 4) {
                if (stats.openEnds === 2) {
                    potential += 10800;
                } else if (stats.openEnds === 1) {
                    potential += 5200;
                }
            } else if (stats.length === 3) {
                if (stats.openEnds === 2) {
                    potential += 4600;
                } else if (stats.openEnds === 1) {
                    potential += 1800;
                }
            } else if (stats.length === 2) {
                if (stats.openEnds === 2) {
                    potential += 900;
                } else if (stats.openEnds === 1) {
                    potential += 300;
                }
            }
        }

        if (openFours >= 1 && openThrees >= 1) {
            potential += 3200;
        }

        if (openThrees >= 2) {
            potential += 5400;
        } else if (openThrees === 1 && semiOpenThrees >= 1) {
            potential += 2200;
        }

        if (semiOpenFours >= 2) {
            potential += 2600;
        }

        return potential;
    }

    getThreatProfile(lineStats) {
        let openFours = 0;
        let semiOpenFours = 0;
        let openThrees = 0;
        let semiOpenThrees = 0;

        for (const stats of lineStats) {
            if (stats.length === 4) {
                if (stats.openEnds === 2) {
                    openFours++;
                } else if (stats.openEnds === 1) {
                    semiOpenFours++;
                }
            } else if (stats.length === 3) {
                if (stats.openEnds === 2) {
                    openThrees++;
                } else if (stats.openEnds === 1) {
                    semiOpenThrees++;
                }
            }
        }

        return { openFours, semiOpenFours, openThrees, semiOpenThrees };
    }

    evaluateDefenseSeverity(profile) {
        const { openFours, semiOpenFours, openThrees, semiOpenThrees } = profile;
        let severity = 0;

        if (openFours >= 2) {
            severity = Math.max(severity, 9500);
        } else if (openFours === 1) {
            severity = Math.max(severity, 9000);
        }

        if (semiOpenFours >= 2 || (semiOpenFours === 1 && openThrees >= 1)) {
            severity = Math.max(severity, 8200);
        } else if (semiOpenFours === 1) {
            severity = Math.max(severity, 7600);
        }

        if (openThrees >= 2) {
            severity = Math.max(severity, 7000);
        } else if (openThrees === 1) {
            severity = Math.max(severity, 5200);
        }

        if (semiOpenThrees >= 2) {
            severity = Math.max(severity, 4800);
        }

        return severity;
    }

    evaluateOffenseSeverity(profile) {
        const { openFours, semiOpenFours, openThrees, semiOpenThrees } = profile;
        let severity = 0;

        if (openFours >= 2) {
            severity = Math.max(severity, 9800);
        } else if (openFours === 1 && (openThrees >= 1 || semiOpenFours >= 1)) {
            severity = Math.max(severity, 9400);
        } else if (openFours === 1) {
            severity = Math.max(severity, 8300);
        }

        if (semiOpenFours >= 2) {
            severity = Math.max(severity, 8200);
        } else if (semiOpenFours === 1 && openThrees >= 1) {
            severity = Math.max(severity, 7800);
        }

        if (openThrees >= 2) {
            severity = Math.max(severity, 7600);
        } else if (openThrees === 1 && semiOpenThrees >= 1) {
            severity = Math.max(severity, 7200);
        } else if (openThrees === 1) {
            severity = Math.max(severity, 6400);
        }

        if (semiOpenThrees >= 2) {
            severity = Math.max(severity, 6100);
        }

        return severity;
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
