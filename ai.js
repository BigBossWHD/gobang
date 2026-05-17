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
            case 'grandmaster':
                move = await this.getGrandmasterMove(aiPlayer);
                break;
            default:
                move = this.getMediumMove(aiPlayer);
        }
        
        if (move) {
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
    },

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

        const urgentThreatMoves = this.findUrgentThreatMoves(opponent, 7800, 3);
        if (urgentThreatMoves.length > 0) {
            const strategicDefense = this.selectStrategicDefenseMove(aiPlayer, urgentThreatMoves, 1);
            if (strategicDefense) {
                return strategicDefense;
            }
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
    },

    // 困难难度AI：更复杂的评分和搜索

    getHardMove(aiPlayer) {
        const opponent = this.getOpponent(aiPlayer);
        let bestScore = -Infinity;
        let bestMove = null;

        // 先处理己方即杀，避免错过直接终局。
        const winningMoves = this.getImmediateWinningMoves(aiPlayer, 2);
        if (winningMoves.length > 0) {
            return this.selectMostPromisingMove(aiPlayer, winningMoves, 1) || winningMoves[0];
        }

        // 对手有即杀点时，必须先解杀。
        const opponentWinningMoves = this.getImmediateWinningMoves(opponent, 2);
        if (opponentWinningMoves.length > 0) {
            const forcedThreats = opponentWinningMoves.map(({ x, y }) => ({ x, y, severity: 10000 }));
            const forcedDefense = this.selectStrategicDefenseMove(aiPlayer, forcedThreats, 2);
            if (forcedDefense) {
                return forcedDefense;
            }
            return opponentWinningMoves[0];
        }

        const tacticalMove = this.findBestTacticalMove(aiPlayer, opponent, 2);
        if (tacticalMove) {
            return tacticalMove;
        }

        const criticalDefense = this.findCriticalDefenseMove(opponent, 5200);
        if (criticalDefense) {
            return criticalDefense;
        }

        const urgentThreatMoves = this.findUrgentThreatMoves(opponent, 7600, 3);
        if (urgentThreatMoves.length > 0) {
            const strategicDefense = this.selectStrategicDefenseMove(aiPlayer, urgentThreatMoves, 2);
            if (strategicDefense) {
                return strategicDefense;
            }
        }

        const forcingAttack = this.findForcingAttack(aiPlayer, 8600);
        if (forcingAttack) {
            this.board[forcingAttack.x][forcingAttack.y] = aiPlayer;
            const unsafeCounter = this.getImmediateWinningMoves(opponent, 2).length > 0;
            this.board[forcingAttack.x][forcingAttack.y] = null;
            if (!unsafeCounter) {
                return forcingAttack;
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

        const stonesPlayed = this.moveHistory.length;
        const searchDepth = stonesPlayed < 8 ? 4 : (stonesPlayed < 24 ? 3 : 2);
        const limit = Math.min(searchDepth >= 4 ? 6 : (searchDepth === 3 ? 8 : 10), scoredCandidates.length);

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
            const counterRiskPenalty = this.evaluateCounterThreatRisk(aiPlayer, opponent);
            let lookaheadScore = 0;
            if (immediateWin) {
                this.board[x][y] = null;
                return { x, y };
            }

            const opponentImmediateWins = this.getImmediateWinningMoves(opponent, 2).length;
            if (opponentImmediateWins > 0) {
                this.board[x][y] = null;
                continue;
            }

            if (forcingSeverity >= 9400 || forkBonus >= 24000 || pressureScore >= 11000 || chainPotential >= 11000) {
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
                + immediateAdvantage * 0.45
                + counterRiskPenalty;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestMove = { x, y };
            }
        }

        if (bestMove) {
            return bestMove;
        }

        return this.getMediumMove(aiPlayer);
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
