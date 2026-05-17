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
        this.llmConfig = {
            endpoint: 'https://api.deepseek.com/v1',
            apiKey: '',
            model: 'deepseek-v4-flash',
            thinkingEnabled: true,
            reasoningEffort: 'high',
            useReasoningFallback: true
        };
        this.llmRequestInFlight = false;
        this.llmTestInFlight = false;
        this.llmAbortController = null;
        this.llmRequestTimeoutMs = 20000;
        this.llmConfigStatus = 'idle';
        this.masterSystemPrompt = this.createGrandmasterSystemPrompt();
        this.messageState = 'idle';
        this.grandmasterLegalMoves = new Set();
        this.activeLlmRequestId = 0;
        this.llmRequestSerial = 0;

        this.restoreLlmConfig();
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
            this.messageState = 'info';

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
            this.messageState = 'info';
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
            this.showAiThinkingMessage();
            this.scheduleAIMove(300, { showThinking: false });
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
        this.cancelOngoingLlmRequest();

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
        this.messageState = 'idle';

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
        this.cancelOngoingLlmRequest();
        this.initializeBoard();
        this.updatePlayerColors();
        this.currentPlayer = 'black';
        this.gameOver = false;
        this.winner = null;
        this.moveHistory = [];
        this.grandmasterLegalMoves = new Set();

        const message = document.getElementById('message');
        message.textContent = '';

        this.clearLastMoveHighlight();
        this.renderBoard();

        if (this.gameMode === 'pve' && this.currentPlayer === this.aiPlayer && !this.gameOver) {
            this.scheduleAIMove(400);
        }

        this.updateLlmTestButtonState();
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
        const llmConfigGroup = document.getElementById('llm-config-group');
        const llmEndpointInput = document.getElementById('llm-endpoint');
        const llmApiKeyInput = document.getElementById('llm-api-key');
        const llmModelInput = document.getElementById('llm-model');
        const llmThinkingEnabledInput = document.getElementById('llm-thinking-enabled');
        const llmReasoningEffortSelect = document.getElementById('llm-reasoning-effort');
        const llmTestButton = document.getElementById('llm-test');
        const llmReasoningFallbackInput = document.getElementById('llm-reasoning-fallback');

        gameModeSelect.value = this.gameMode;
        difficultySelect.value = this.difficulty;
        playerRoleSelect.value = this.playerRole;
        if (llmEndpointInput) {
            llmEndpointInput.value = this.llmConfig.endpoint;
        }
        if (llmApiKeyInput) {
            llmApiKeyInput.value = this.llmConfig.apiKey;
        }
        if (llmModelInput) {
            llmModelInput.value = this.llmConfig.model;
        }
        if (llmThinkingEnabledInput) {
            llmThinkingEnabledInput.checked = this.llmConfig.thinkingEnabled !== false;
        }
        if (llmReasoningEffortSelect) {
            llmReasoningEffortSelect.value = this.llmConfig.reasoningEffort === 'max' ? 'max' : 'high';
            llmReasoningEffortSelect.disabled = this.llmConfig.thinkingEnabled === false;
        }
        if (llmReasoningFallbackInput) {
            llmReasoningFallbackInput.checked = this.llmConfig.useReasoningFallback !== false;
        }

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
                this.toggleDifficultySetting();
                if (this.gameMode === 'pve' && newDifficulty === 'grandmaster') {
                    this.showInfoMessage('大模型模式开启，请确保配置完整且稳定。');
                }
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

        const handleConfigChange = () => {
            this.llmConfigStatus = 'idle';
            this.persistLlmConfig();
            this.updateLlmTestButtonState();
        };

        if (llmEndpointInput) {
            llmEndpointInput.addEventListener('input', (event) => {
                this.llmConfig.endpoint = event.target.value.trim();
                handleConfigChange();
            });
        }
        if (llmApiKeyInput) {
            llmApiKeyInput.addEventListener('input', (event) => {
                this.llmConfig.apiKey = event.target.value.trim();
                handleConfigChange();
            });
        }
        if (llmModelInput) {
            llmModelInput.addEventListener('input', (event) => {
                this.llmConfig.model = event.target.value.trim();
                handleConfigChange();
            });
        }
        if (llmThinkingEnabledInput) {
            llmThinkingEnabledInput.addEventListener('change', (event) => {
                this.llmConfig.thinkingEnabled = Boolean(event.target.checked);
                if (llmReasoningEffortSelect) {
                    llmReasoningEffortSelect.disabled = !this.llmConfig.thinkingEnabled;
                }
                handleConfigChange();
            });
        }
        if (llmReasoningEffortSelect) {
            llmReasoningEffortSelect.addEventListener('change', (event) => {
                this.llmConfig.reasoningEffort = event.target.value === 'max' ? 'max' : 'high';
                handleConfigChange();
            });
        }
        if (llmReasoningFallbackInput) {
            llmReasoningFallbackInput.addEventListener('change', (event) => {
                this.llmConfig.useReasoningFallback = Boolean(event.target.checked);
                handleConfigChange();
            });
        }

        if (llmConfigGroup) {
            if (this.gameMode === 'pve' && this.difficulty === 'grandmaster') {
                llmConfigGroup.classList.remove('hidden');
            } else {
                llmConfigGroup.classList.add('hidden');
            }
        }

        if (llmTestButton) {
            llmTestButton.addEventListener('click', async () => {
                await this.testLlmConnection();
            });
        }

        this.updateLlmTestButtonState();
    }

    // 切换难度设置的显示/隐藏

    toggleDifficultySetting() {
        const difficultyGroup = document.getElementById('difficulty-group');
        const roleGroup = document.getElementById('player-role-group');
        const llmConfigGroup = document.getElementById('llm-config-group');
        if (this.gameMode === 'pve') {
            if (difficultyGroup) {
                difficultyGroup.classList.remove('hidden');
            }
            if (roleGroup) {
                roleGroup.classList.remove('hidden');
            }
            if (llmConfigGroup) {
                if (this.difficulty === 'grandmaster') {
                    llmConfigGroup.classList.remove('hidden');
                } else {
                    llmConfigGroup.classList.add('hidden');
                }
            }
        } else {
            if (difficultyGroup) {
                difficultyGroup.classList.add('hidden');
            }
            if (roleGroup) {
                roleGroup.classList.add('hidden');
            }
            if (llmConfigGroup) {
                llmConfigGroup.classList.add('hidden');
            }
        }

        this.updateLlmTestButtonState();
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

    scheduleAIMove(delay = 300, options = {}) {
        const { showThinking = true } = options;
        if (this.aiTimeoutId) {
            clearTimeout(this.aiTimeoutId);
        }
        if (showThinking) {
            this.showAiThinkingMessage();
        }
        this.aiTimeoutId = setTimeout(async () => {
            this.aiTimeoutId = null;
            try {
                await this.makeAIMove();
            } catch (error) {
                console.error('AI move execution failed:', error);
        this.showInfoMessage('AI 落子失败，已保留当前局面。');
            }
        }, delay);
    }

    cancelScheduledAIMove() {
        if (this.aiTimeoutId) {
            clearTimeout(this.aiTimeoutId);
            this.aiTimeoutId = null;
        }
    }

    cancelOngoingLlmRequest() {
        if (this.llmRequestInFlight || this.activeLlmRequestId !== 0) {
            if (this.llmAbortController) {
                this.llmAbortController.abort();
                this.llmAbortController = null;
            }
            this.llmRequestInFlight = false;
            this.activeLlmRequestId = 0;
            this.updateLlmTestButtonState();
        }
    }

    getOpponent(player) {
        return player === 'black' ? 'white' : 'black';
    }

    // 从高分候选中按权重随机选择，避免每局完全固定

    showInfoMessage(text) {
        if (typeof text !== 'string' || text.length === 0) {
            return;
        }
        if (this.gameOver) {
            return;
        }
        const message = document.getElementById('message');
        if (message) {
            message.textContent = text;
        }
        this.messageState = 'info';
    }

    displayGrandmasterBanter(banter, analysis = '') {
        if (typeof banter !== 'string' || banter.length === 0) {
            return;
        }
        if (this.gameOver) {
            return;
        }
        const message = document.getElementById('message');
        if (!message) {
            return;
        }
        const trimmedAnalysis = typeof analysis === 'string' ? analysis.trim() : '';
        message.textContent = trimmedAnalysis ? `${banter}\n${trimmedAnalysis}` : banter;
        this.messageState = 'banter';
    }

    showAiThinkingMessage() {
        if (this.gameOver) {
            return;
        }
        const message = document.getElementById('message');
        if (!message) {
            return;
        }
        let text = 'AI 正在思考…';
        if (this.difficulty === 'grandmaster') {
            text = '大师AI 正在推演下一手…';
        } else if (this.difficulty === 'hard') {
            text = 'AI 正在精算后续变化…';
        }
        message.textContent = text;
        this.messageState = 'thinking';
    }

    clearMessage() {
        const message = document.getElementById('message');
        if (message) {
            message.textContent = '';
        }
        this.messageState = 'idle';
    }

    restoreLlmConfig() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }

        try {
            const raw = window.localStorage.getItem('gomoku.llmConfig');
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            this.llmConfig = {
                endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : 'https://api.deepseek.com/v1',
                apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
                model: typeof parsed.model === 'string' ? parsed.model : 'deepseek-v4-flash',
                thinkingEnabled: typeof parsed.thinkingEnabled === 'boolean' ? parsed.thinkingEnabled : true,
                reasoningEffort: parsed.reasoningEffort === 'max' ? 'max' : 'high',
                useReasoningFallback: typeof parsed.useReasoningFallback === 'boolean' ? parsed.useReasoningFallback : true
            };
        } catch (error) {
            console.error('Failed to restore LLM config:', error);
            this.llmConfig = {
                endpoint: 'https://api.deepseek.com/v1',
                apiKey: '',
                model: 'deepseek-v4-flash',
                thinkingEnabled: true,
                reasoningEffort: 'high',
                useReasoningFallback: true
            };
        }
    }

    persistLlmConfig() {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }

        try {
            window.localStorage.setItem('gomoku.llmConfig', JSON.stringify(this.llmConfig));
        } catch (error) {
            console.error('Failed to persist LLM config:', error);
        }
    }

    isInsideBoard(x, y) {
        return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize;
    }
}

window.GomokuGame = GomokuGame;
