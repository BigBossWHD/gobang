// 五子棋 AI 逻辑
Object.assign(GomokuGame.prototype, {
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
    },

    // AI落子

    async makeAIMove() {
        if (this.gameOver || this.gameMode !== 'pve' || this.currentPlayer !== this.aiPlayer) return;
        
        const aiPlayer = this.aiPlayer;
        const turnSerial = this.aiTurnSerial;
        let move;
        switch (this.difficulty) {
            case 'easy':
                move = this.getEasyMove(aiPlayer);
                break;
            case 'medium':
                move = this.getMediumMove(aiPlayer);
                break;
            case 'hard':
                move = await this.getHardMoveAsync(aiPlayer);
                break;
            case 'grandmaster':
                move = await this.getGrandmasterMove(aiPlayer);
                break;
            default:
                move = this.getMediumMove(aiPlayer);
        }
        
        if (move && turnSerial === this.aiTurnSerial && !this.gameOver
            && this.gameMode === 'pve' && this.currentPlayer === aiPlayer) {
            this.makeMove(move.x, move.y);
            if (this.difficulty === 'grandmaster' && !this.gameOver && move.banter) {
                this.displayGrandmasterBanter(move.banter, move.analysis);
            } else if (!this.gameOver && this.messageState === 'thinking') {
                this.clearMessage();
            }
        }
    },

    
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
    },

    // 中等难度：少量候选，迭代计算最多三层双方应手。
    getMediumMove(aiPlayer) {
        return this.getSearchedMove(aiPlayer, {
            maxDepth: 3,
            timeLimit: 250,
            rootWidth: 12,
            nodeLimit: 3000,
            forcingDepth: 0
        });
    },

    // 困难难度：按对手最强应手搜索，只有完整算完的一层才能替换结果。
    async getHardMoveAsync(aiPlayer) {
        if (typeof Worker === 'undefined') return this.getHardMove(aiPlayer);
        return new Promise(resolve => {
            let worker;
            try {
                worker = new Worker('ai-worker.js?v=20261008-6');
            } catch {
                resolve(this.getHardMove(aiPlayer));
                return;
            }
            const finish = move => {
                worker.terminate();
                if (this.aiSearchWorker === worker) {
                    this.aiSearchWorker = null;
                    this.cancelAiSearch = null;
                }
                resolve(move);
            };
            this.aiSearchWorker = worker;
            this.cancelAiSearch = () => finish(null);
            worker.onmessage = event => finish(event.data);
            worker.onerror = () => finish(this.getHardMove(aiPlayer));
            worker.postMessage({ board: this.board, moveHistory: this.moveHistory, aiPlayer });
        });
    },

    getHardMove(aiPlayer) {
        return this.getSearchedMove(aiPlayer);
    },

    getSearchedMove(aiPlayer, options = {}) {
        const { maxDepth = 6, timeLimit = 1200, rootWidth = 16, nodeLimit = 12000, forcingDepth = 6 } = options;
        const deadline = performance.now() + timeLimit;
        const candidates = this.getSearchMoves(aiPlayer);
        if (candidates.length === 0) return null;
        if (candidates[0].win || candidates.length === 1) {
            return { x: candidates[0].x, y: candidates[0].y };
        }

        const context = {
            deadline,
            nodes: 0,
            nodeLimit,
            timeout: {},
            table: new Map()
        };
        // 连续冲四专用搜索能越过普通搜索的宽度和层数限制。
        if (forcingDepth > 0 && timeLimit > 0) {
            const forcingContext = {
                deadline: Math.min(deadline, performance.now() + timeLimit * 0.25),
                nodes: 0,
                nodeLimit: Math.min(nodeLimit, 2000),
                timeout: {}
            };
            try {
                const forced = this.findContinuousFour(aiPlayer, forcingDepth, forcingContext);
                if (forced) return { x: forced.x, y: forced.y };
            } catch (error) {
                if (error !== forcingContext.timeout) throw error;
            }
        }
        let bestMove = candidates[0];
        // 每层均保留攻防候选，避免只计算自己想下的棋。
        const rootMoves = candidates.slice(0, rootWidth);
        for (let depth = 2; depth <= maxDepth; depth++) {
            context.table.clear();
            let layerBest = null;
            let layerScore = -Infinity;
            let alpha = -Infinity;
            try {
                for (const move of rootMoves) {
                    this.checkSearchBudget(context);
                    this.board[move.x][move.y] = aiPlayer;
                    let score;
                    try {
                        score = this.minimaxSearch(depth - 1, alpha, Infinity,
                            this.getOpponent(aiPlayer), aiPlayer, depth, context);
                    } finally {
                        this.board[move.x][move.y] = null;
                    }
                    if (score > layerScore) {
                        layerScore = score;
                        layerBest = move;
                    }
                    alpha = Math.max(alpha, score);
                }
            } catch (error) {
                if (error !== context.timeout) throw error;
                break;
            }
            bestMove = layerBest || bestMove;
            rootMoves.sort((a, b) => Number(b === bestMove) - Number(a === bestMove) || b.score - a.score);
            if (layerScore > 90000000) break;
        }
        return { x: bestMove.x, y: bestMove.y };
    },

    // 只返回已证明的冲四必胜线；找不到或预算不足不代表不存在胜法。
    findContinuousFour(attacker, remainingAttacks, context) {
        this.checkSearchBudget(context);
        const defender = this.getOpponent(attacker);
        const moves = this.getSearchMoves(attacker);
        if (!moves.length) return null;
        if (moves[0].win) return moves[0];
        if (remainingAttacks <= 0) return null;
        for (const move of moves) {
            this.checkSearchBudget(context);
            // 分数只做预筛；下面用真实成五点验证，不凭棋型分数宣告必胜。
            if (move.attackScore < 12000) continue;
            this.board[move.x][move.y] = attacker;
            try {
                if (this.getImmediateWinningMoves(defender).length) continue;
                const wins = this.getImmediateWinningMoves(attacker);
                if (wins.length >= 2) return move;
                if (wins.length !== 1) continue;
                const block = wins[0];
                this.board[block.x][block.y] = defender;
                try {
                    if (this.findContinuousFour(attacker, remainingAttacks - 1, context)) {
                        return move;
                    }
                } finally {
                    this.board[block.x][block.y] = null;
                }
            } finally {
                this.board[move.x][move.y] = null;
            }
        }
        return null;
    },

    checkSearchBudget(context) {
        if (!context) return;
        context.nodes++;
        if (context.nodes > context.nodeLimit || performance.now() >= context.deadline) {
            throw context.timeout;
        }
    },

    // 评分只用于排序；成五和必须挡住的点不受候选宽度限制。
    getSearchMoves(player) {
        const opponent = this.getOpponent(player);
        const moves = this.getCandidateMoves(2).map(({ x, y }) => {
            const attack = this.analyzePlacement(x, y, player);
            const defense = this.analyzePlacement(x, y, opponent);
            const attackScore = this.scoreSearchThreat(attack);
            const defenseScore = this.scoreSearchThreat(defense);
            return {
                x, y,
                win: attack.lineStats.some(stats => stats.length >= 5),
                block: defense.lineStats.some(stats => stats.length >= 5),
                attackScore,
                defenseScore,
                score: Math.max(attackScore, defenseScore * 1.08)
                    + Math.min(attackScore, defenseScore) * 0.15
                    + this.centerBias(x, y, 3)
            };
        });
        moves.sort((a, b) => b.score - a.score);
        const wins = moves.filter(move => move.win);
        if (wins.length) return wins;
        const blocks = moves.filter(move => move.block);
        return blocks.length ? blocks : moves;
    },

    scoreSearchThreat(analysis) {
        const stats = analysis.lineStats;
        if (stats.some(line => line.length >= 5)) return 100000000;
        const profile = this.getThreatProfile(stats);
        const { openFours, semiOpenFours, openThrees } = profile;
        if (openFours || semiOpenFours >= 2) return 1000000;
        if (semiOpenFours && openThrees) return 150000;
        if (openThrees >= 2) return 60000;
        return analysis.score + semiOpenFours * 12000 + openThrees * 3000;
    },

    evaluateSearchPosition(aiPlayer, moves = null, currentPlayer = aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        let ownBest = 0;
        let ownSecond = 0;
        let enemyBest = 0;
        let enemySecond = 0;
        const scored = moves || this.getCandidateMoves(2).map(({ x, y }) => ({
            attackScore: this.scoreSearchThreat(this.analyzePlacement(x, y, aiPlayer)),
            defenseScore: this.scoreSearchThreat(this.analyzePlacement(x, y, opponent))
        }));
        for (const move of scored) {
            const own = currentPlayer === aiPlayer ? move.attackScore : move.defenseScore;
            const enemy = currentPlayer === aiPlayer ? move.defenseScore : move.attackScore;
            if (own > ownBest) { ownSecond = ownBest; ownBest = own; }
            else if (own > ownSecond) ownSecond = own;
            if (enemy > enemyBest) { enemySecond = enemyBest; enemyBest = enemy; }
            else if (enemy > enemySecond) enemySecond = enemy;
        }
        return ownBest + ownSecond * 0.2 - enemyBest - enemySecond * 0.2;
    },

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
    },

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
    },

    getImmediateWinningMoves(player, radius = 2) {
        const candidates = this.getCandidateMoves(radius);
        const winningMoves = [];

        for (const { x, y } of candidates) {
            if (this.board[x][y] !== null) continue;
            this.board[x][y] = player;
            const isWinningMove = this.checkWin(x, y);
            this.board[x][y] = null;
            if (isWinningMove) {
                winningMoves.push({ x, y });
            }
        }

        return winningMoves;
    },

    findUrgentThreatMoves(player, minSeverity = 7800, radius = 3) {
        const candidates = this.getCandidateMoves(radius);
        const threateningMoves = [];

        for (const { x, y } of candidates) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = player;
            const isWinningMove = this.checkWin(x, y);
            const lineStats = this.collectLineStats(x, y, player);
            const profile = this.getThreatProfile(lineStats);
            const forkBonus = this.calculateForkBonus(lineStats);
            const pressure = this.calculateOffensivePressure(lineStats);
            this.board[x][y] = null;

            const severity = isWinningMove
                ? 10000
                : Math.max(this.evaluateOffenseSeverity(profile), forkBonus / 3, pressure / 2);

            if (severity >= minSeverity) {
                threateningMoves.push({ x, y, severity });
            }
        }

        threateningMoves.sort((a, b) => b.severity - a.severity);
        return threateningMoves;
    },

    selectStrategicDefenseMove(aiPlayer, threateningMoves, depth = 2) {
        if (!threateningMoves || threateningMoves.length === 0) {
            return null;
        }

        const opponent = this.getOpponent(aiPlayer);
        let bestMove = null;
        let bestScore = -Infinity;
        const used = new Set();

        for (const { x, y } of threateningMoves) {
            if (this.board[x][y] !== null) continue;
            const key = `${x},${y}`;
            if (used.has(key)) continue;
            used.add(key);

            this.board[x][y] = aiPlayer;
            const immediateWin = this.checkWin(x, y);
            if (immediateWin) {
                this.board[x][y] = null;
                return { x, y };
            }

            const opponentWinningMoves = this.getImmediateWinningMoves(opponent, 2).length;
            const remainingThreats = this.findUrgentThreatMoves(opponent, 7600, 3).length;
            const initiative = this.findUrgentThreatMoves(aiPlayer, 8600, 3).length;
            const boardAdvantage = this.evaluateBoardAdvantage(aiPlayer);
            const lookahead = depth > 0
                ? this.minimaxSearch(depth, -Infinity, Infinity, opponent, aiPlayer, depth)
                : 0;
            this.board[x][y] = null;

            const score = boardAdvantage
                + (Number.isFinite(lookahead) ? lookahead * 0.5 : 0)
                - opponentWinningMoves * 120000
                - remainingThreats * 9500
                + initiative * 3200;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { x, y };
            }
        }

        return bestMove;
    },

    evaluateCounterThreatRisk(aiPlayer, opponent) {
        const opponentWinningMoves = this.getImmediateWinningMoves(opponent, 2).length;
        if (opponentWinningMoves > 0) {
            return -120000 - (opponentWinningMoves - 1) * 18000;
        }

        const severeThreats = this.findUrgentThreatMoves(opponent, 9000, 3).length;
        const aiImmediateThreats = this.findUrgentThreatMoves(aiPlayer, 9000, 3).length;
        return -severeThreats * 6000 + aiImmediateThreats * 1800;
    },

    selectMostPromisingMove(aiPlayer, moves, depth = 1) {
        if (!Array.isArray(moves) || moves.length === 0) {
            return null;
        }

        let bestMove = null;
        let bestScore = -Infinity;

        for (const { x, y } of moves) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = aiPlayer;
            const immediateWin = this.checkWin(x, y);
            const opponent = this.getOpponent(aiPlayer);
            const lookahead = depth > 0
                ? this.minimaxSearch(depth, -Infinity, Infinity, opponent, aiPlayer, depth)
                : 0;
            const boardAdvantage = this.evaluateBoardAdvantage(aiPlayer);
            this.board[x][y] = null;

            const score = (immediateWin ? 300000 : 0)
                + (Number.isFinite(lookahead) ? lookahead : 0)
                + boardAdvantage * 0.4;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { x, y };
            }
        }

        return bestMove;
    },

    findBestTacticalMove(aiPlayer, opponent, radius = 2) {
        const candidates = this.getCandidateMoves(radius);
        let bestMove = null;
        let bestScore = -Infinity;

        for (const { x, y } of candidates) {
            if (this.board[x][y] !== null) continue;

            this.board[x][y] = aiPlayer;
            if (this.checkWin(x, y)) {
                this.board[x][y] = null;
                return { x, y };
            }

            const opponentWins = this.getImmediateWinningMoves(opponent, 2).length;
            if (opponentWins > 0) {
                this.board[x][y] = null;
                continue;
            }

            const aiNextWins = this.getImmediateWinningMoves(aiPlayer, 2).length;
            const aiThreats = this.findUrgentThreatMoves(aiPlayer, 8600, 3).length;
            const opponentThreats = this.findUrgentThreatMoves(opponent, 7600, 3).length;
            const boardAdvantage = this.evaluateBoardAdvantage(aiPlayer);
            this.board[x][y] = null;

            const score = aiNextWins * 92000
                + aiThreats * 6200
                + boardAdvantage
                - opponentThreats * 7600;

            if (score > bestScore) {
                bestScore = score;
                bestMove = { x, y };
            }
        }

        if (bestScore >= 45000) {
            return bestMove;
        }

        return null;
    },

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
    },

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
    },

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
    },

    centerBias(x, y, weight = 50) {
        const center = Math.floor(this.boardSize / 2);
        const distance = Math.abs(x - center) + Math.abs(y - center);
        const bias = weight - distance * 8;
        return bias > 0 ? bias : 0;
    },

    estimateOpponentBestScore(radius = 2) {
        if (!this.aiPlayer) {
            return 0;
        }
        const opponent = this.getOpponent(this.aiPlayer);
        return this.estimateBestScoreForPlayer(opponent, radius);
    },

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
    },

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
    },

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
    },

    minimaxSearch(depth, alpha, beta, currentPlayer, aiPlayer, initialDepth = depth, context = null, extensions = 0) {
        this.checkSearchBudget(context);
        const maximizing = currentPlayer === aiPlayer;
        const ply = initialDepth - depth + extensions;
        const candidates = this.getSearchMoves(currentPlayer);
        if (!candidates.length) return 0;
        if (candidates[0].win) {
            return maximizing ? 100000000 - ply * 1000 : -100000000 + ply * 1000;
        }
        // 两个不同的即杀点无法用一手同时挡住。
        if (candidates.length > 1 && candidates[0].block) {
            return maximizing ? -100000000 + (ply + 1) * 1000 : 100000000 - (ply + 1) * 1000;
        }
        // 搜索到边界时继续算完强制挡四，避免把尚未处理的威胁当作静态局面。
        if (depth <= 0 && (!candidates[0].block || extensions >= 4)) {
            return candidates[0].block ? this.evaluateSearchPosition(aiPlayer)
                : this.evaluateSearchPosition(aiPlayer, candidates, currentPlayer);
        }
        const key = context ? `${currentPlayer}:${depth}:${extensions}:${this.board.map(row => row.map(cell => cell === 'black' ? 'b' : cell === 'white' ? 'w' : '.').join('')).join('')}` : '';
        const cached = context?.table.get(key);
        if (cached !== undefined) return cached;
        const limit = Math.min(depth >= 3 ? 10 : 8, candidates.length);
        let bestValue = maximizing ? -Infinity : Infinity;
        let cutOff = false;
        const originalAlpha = alpha;
        const originalBeta = beta;
        for (const { x, y } of candidates.slice(0, limit)) {
            this.checkSearchBudget(context);
            this.board[x][y] = currentPlayer;
            let value;
            try {
                value = this.minimaxSearch(Math.max(0, depth - 1), alpha, beta,
                    this.getOpponent(currentPlayer), aiPlayer, initialDepth, context,
                    extensions + (depth <= 0 ? 1 : 0));
            } finally {
                this.board[x][y] = null;
            }
            bestValue = maximizing ? Math.max(bestValue, value) : Math.min(bestValue, value);
            if (maximizing) alpha = Math.max(alpha, bestValue);
            else beta = Math.min(beta, bestValue);
            if (beta <= alpha) { cutOff = true; break; }
        }
        // 窗口外的值只是上下界，不能作为精确值复用。
        if (context && !cutOff && bestValue > originalAlpha && bestValue < originalBeta) {
            context.table.set(key, bestValue);
        }
        return bestValue;
    },

    analyzePlacement(x, y, player) {
        if (this.board[x][y] !== null) {
            return null;
        }

        this.board[x][y] = player;
        const lineStats = this.collectLineStats(x, y, player);
        const score = lineStats.reduce((total, stats) => total + this.scoreLine(stats.length, stats.openEnds), 0);
        this.board[x][y] = null;

        return { score, lineStats };
    },

    // 评估位置得分

    evaluatePosition(x, y, player) {
        const analysis = this.analyzePlacement(x, y, player);
        return analysis ? analysis.score : 0;
    },

    // 高级位置评估

    evaluateAdvancedPosition(x, y, player = this.aiPlayer || 'white') {
        return this.evaluateAdvancedPositionForPlayer(x, y, player);
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    collectLineStats(x, y, player) {
        const directions = [
            [1, 0],   // 水平
            [0, 1],   // 垂直
            [1, 1],   // 对角线 \
            [1, -1]   // 对角线 /
        ];

        return directions.map(([dx, dy]) => this.getLineStats(x, y, dx, dy, player));
    },

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

        if (length >= 5) return { length, openEnds };
        const line = [];
        for (let offset = -5; offset <= 5; offset++) {
            const row = x + dx * offset;
            const col = y + dy * offset;
            line.push(!this.isInsideBoard(row, col) ? '#'
                : this.board[row][col] === player ? 'X'
                    : this.board[row][col] === null ? '.' : '#');
        }
        const winningPoints = new Set();
        for (let start = 1; start <= 5; start++) {
            let own = 0;
            let empty = -1;
            for (let index = start; index < start + 5; index++) {
                if (line[index] === 'X') own++;
                else if (line[index] === '.') empty = index;
            }
            if (own === 4 && empty !== -1) winningPoints.add(empty);
        }
        if (winningPoints.size) return { length: 4, openEnds: Math.min(2, winningPoints.size) };
        for (let start = 0; start <= 5; start++) {
            // 当前棋子必须在中间四格；两端必须为空，不能把边界当成活口。
            if (5 <= start || 5 >= start + 5 || line[start] !== '.' || line[start + 5] !== '.') continue;
            let own = 0;
            let empty = false;
            for (let index = start + 1; index < start + 5; index++) {
                if (line[index] === 'X') own++;
                else if (line[index] === '.') empty = true;
            }
            if (own === 3 && empty) return { length: 3, openEnds: 2 };
        }
        // 连续三子的两端为空仍可能因为外侧封堵而无法形成活四。
        if (length === 3 && openEnds === 2) openEnds = 1;
        return { length, openEnds };
    },

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
});
