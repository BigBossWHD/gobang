// 大模型配置与请求逻辑
Object.assign(GomokuGame.prototype, {
    async getGrandmasterMove(aiPlayer) {
        if (this.llmRequestInFlight) {
            return this.getHardMove(aiPlayer);
        }

        const { endpoint, apiKey, model } = this.llmConfig;
        const requiresApiKey = this.shouldRequireApiKey(endpoint);
        if (!endpoint || !model || (requiresApiKey && !apiKey)) {
            this.showInfoMessage('请填写完整的大模型端点、模型名称和必要的访问密钥。');
            return this.getHardMove(aiPlayer);
        }

        const requestUrl = this.normalizeLlmEndpoint(endpoint);
        if (!requestUrl) {
            this.showInfoMessage('无法识别的大模型端点，已回退为困难难度。');
            return this.getHardMove(aiPlayer);
        }

        const primaryPayload = this.buildGrandmasterRequestPayload(aiPlayer);
        const fallbackPayload = this.buildGrandmasterFallbackPayload(aiPlayer);
        const toolCallPayload = this.buildGrandmasterToolCallPayload(aiPlayer);
        const attempts = [
            { payload: primaryPayload, allowResponseFormatRetry: true },
            { payload: fallbackPayload, allowResponseFormatRetry: false },
            { payload: toolCallPayload, allowResponseFormatRetry: false }
        ];

        this.llmRequestInFlight = true;
        const requestId = ++this.llmRequestSerial;
        this.activeLlmRequestId = requestId;
        this.llmAbortController = new AbortController();
        this.updateLlmTestButtonState();
        this.updateLlmConfigStatus('thinking');

        try {
            for (let i = 0; i < attempts.length; i++) {
                const attemptConfig = attempts[i];
                if (!attemptConfig.payload) {
                    continue;
                }

                if (i === 1) {
                    console.warn('Retrying grandmaster LLM with strict JSON instructions…');
                } else if (i === 2) {
                    console.warn('Retrying grandmaster LLM with forced tool call…');
                }

                const { data, rawText } = await this.postChatCompletion(
                    requestUrl,
                    attemptConfig.payload,
                    apiKey,
                    {
                        allowResponseFormatRetry: attemptConfig.allowResponseFormatRetry,
                        signal: this.llmAbortController.signal,
                        timeoutMs: this.llmRequestTimeoutMs
                    }
                );

                if (requestId !== this.activeLlmRequestId) {
                    return null;
                }

                const extracted = this.extractGrandmasterResponse(data);
                if (extracted && extracted.move && Number.isInteger(extracted.move.x) && Number.isInteger(extracted.move.y)) {
                    const { x, y } = extracted.move;
                    if (this.isCellAvailable(x, y)) {
                        const stabilizedMove = this.stabilizeGrandmasterMove(aiPlayer, { x, y });
                        if (stabilizedMove) {
                            const isReplaced = stabilizedMove.x !== x || stabilizedMove.y !== y;
                            return {
                                x: stabilizedMove.x,
                                y: stabilizedMove.y,
                                banter: isReplaced
                                    ? '大师AI纠错保命成功'
                                    : (typeof extracted.banter === 'string' ? extracted.banter : ''),
                                analysis: isReplaced
                                    ? '攻:稳住节奏反击; 守:先消除即杀点'
                                    : (typeof extracted.analysis === 'string' ? extracted.analysis : '')
                            };
                        }

                        return {
                            x,
                            y,
                            banter: typeof extracted.banter === 'string' ? extracted.banter : '',
                            analysis: typeof extracted.analysis === 'string' ? extracted.analysis : ''
                        };
                    }
                    console.warn('Parsed move not available on board:', extracted.move);
                } else {
                    console.warn('Failed to parse LLM move from response.');
                }
            }

            this.showInfoMessage('大模型建议的坐标无法落子，改用困难难度继续对决。');
        } catch (error) {
            if (error && error.name === 'AbortError') {
                this.showInfoMessage('大模型请求已取消。');
                return null;
            }
            console.error('Grandmaster LLM move failed:', error);
            this.showInfoMessage('大模型调用超时或失败，暂以困难难度应对。');
        } finally {
            if (requestId === this.activeLlmRequestId) {
                this.llmRequestInFlight = false;
                this.activeLlmRequestId = 0;
                this.llmAbortController = null;
                this.updateLlmTestButtonState();
            }
        }

        return this.getHardMove(aiPlayer);
    },

    buildGrandmasterRequestPayload(aiPlayer) {
        return this.withThinkingOptions({
            model: this.llmConfig.model,
            temperature: 0.2,
            top_p: 0.7,
            max_tokens: 8192,
            stream: false,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: this.masterSystemPrompt
                },
                {
                    role: 'user',
                    content: this.buildGrandmasterTurnPrompt(aiPlayer)
                }
            ]
        });
    },

    buildGrandmasterFallbackPayload(aiPlayer) {
        const reminder = '上一次回复未输出 JSON，请立刻仅返回 {"move":{"x":行索引,"y":列索引},"analysis":"攻:xx; 守:xx","banter":"8到16字自嘲"}，禁止任何前缀、解释或 reasoning。';
        return this.withThinkingOptions({
            model: this.llmConfig.model,
            temperature: 0.1,
            top_p: 0.5,
            max_tokens: 8192,
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: this.masterSystemPrompt
                },
                {
                    role: 'user',
                    content: this.buildGrandmasterTurnPrompt(aiPlayer)
                },
                {
                    role: 'user',
                    content: reminder
                }
            ]
        });
    },

    buildGrandmasterToolCallPayload(aiPlayer) {
        const toolDescription = {
            type: 'function',
            function: {
                name: 'submit_move',
                description: '在候选坐标中挑选落子点并给出攻守分析。',
                parameters: {
                    type: 'object',
                    properties: {
                        x: {
                            type: 'integer',
                            description: '落子行索引（0-14）'
                        },
                        y: {
                            type: 'integer',
                            description: '落子列索引（0-14）'
                        },
                        analysis: {
                            type: 'string',
                            description: '攻守要点，格式为 "攻:..; 守:.."'
                        },
                        banter: {
                            type: 'string',
                            description: '8-16 字幽默自嘲语'
                        }
                    },
                    required: ['x', 'y', 'analysis', 'banter']
                }
            }
        };

        return this.withThinkingOptions({
            model: this.llmConfig.model,
            temperature: 0.1,
            top_p: 0.4,
            max_tokens: 8192,
            stream: false,
            tools: [toolDescription],
            tool_choice: {
                type: 'function',
                function: {
                    name: 'submit_move'
                }
            },
            messages: [
                {
                    role: 'system',
                    content: `${this.masterSystemPrompt}\n\n若系统提供了函数 submit_move，请直接调用该函数，并在 arguments 内填写坐标与攻守说明。`
                },
                {
                    role: 'user',
                    content: this.buildGrandmasterTurnPrompt(aiPlayer)
                }
            ]
        });
    },

    withThinkingOptions(payload) {
        const thinkingEnabled = this.llmConfig.thinkingEnabled !== false;
        const normalizedEffort = this.llmConfig.reasoningEffort === 'max' ? 'max' : 'high';
        const nextPayload = {
            ...payload,
            thinking: {
                type: thinkingEnabled ? 'enabled' : 'disabled'
            }
        };

        if (thinkingEnabled) {
            nextPayload.reasoning_effort = normalizedEffort;
            delete nextPayload.temperature;
            delete nextPayload.top_p;
        }

        return nextPayload;
    },

    createGrandmasterSystemPrompt() {
        return `你是一名以缜密读秒著称、擅长实战推演的顶级五子棋大师 AI 教练。收到局面后，必须逐行核对 15×15 棋盘：“B” 代表黑子、“W” 代表白子、“.” 代表空点，坐标以 (x, y) 表示行列索引均从 0 开始。请据实复盘双方厚势、威胁与空位，严禁臆测或遗漏既有棋子。系统会提供“合法落子候选”列表，你必须且只能在该列表中落子，并确认目标点当前为空。

任务准则：
1. 先识别对手最具杀伤力的威胁，给出紧迫程度与防守手段。
2. 再评估己方可转入主动的攻势线路，兼顾活四、双三、冲四等关键节奏。
3. 当多手棋势相近时，权衡短期防守与长期控盘价值，给出理性取舍。

执行流程：
• 盘势诊断：结合棋盘与威胁雷达，罗列双方关键线型与空点。
• 攻守筹划：为候选点筛选至少一处主攻方案与一处补防方案，必要时提出备选与风险提示。
• 方案验证：确认所选坐标在候选列表中，同时再次校验该点确为空位且不会违反禁手（若有提示）。

输出要求：仅输出 JSON，对象需包含 move、analysis、banter 三个字段，禁止出现额外文本或解释。analysis 字段需采用 "攻:...; 守:..." 格式，同时给出攻守理由（各不超过 16 字）。banter 字段保持 8-16 字的轻松自嘲语气，但不得降低专业判断。若模型默认生成 reasoning，请令 reasoning 为空字符串，把全部说明写入 JSON 字段，并确保整条回复以 { 开头、以 } 结束，不出现任何前后缀。`;
    },

    buildGrandmasterTurnPrompt(aiPlayer) {
        const aiName = aiPlayer === 'black' ? '黑棋' : '白棋';
        const opponent = this.getOpponent(aiPlayer) === 'black' ? '黑棋' : '白棋';
        const perspective = this.humanPlayer === aiPlayer ? '玩家' : 'AI';
        const boardDiagram = this.formatBoardForPrompt();
        const recentMoves = this.formatRecentMovesForPrompt();
        const remainingSpaces = this.boardSize * this.boardSize - this.moveHistory.length;

        const threatSummary = this.formatThreatSummaryForPrompt();
        const legalMovesText = this.formatLegalMovesForPrompt(aiPlayer);
        const strategicHints = this.formatStrategicHintsForPrompt(aiPlayer);

        const sections = [
            `轮到 ${aiName} 行棋，对手是 ${opponent}。`,
            `当前身份：${perspective} 控制 ${aiName}。`,
            `剩余空位：${remainingSpaces}。`,
            '棋盘布局：',
            boardDiagram,
            '最近落子：',
            recentMoves,
            '威胁雷达：',
            threatSummary,
            '本地战术建议（优先参考）：',
            strategicHints,
            '合法落子候选（仅可从中选择一处）：',
            legalMovesText,
            '请给出能够兼顾主动进攻与防守要点的最佳落子，优先考虑活四、双三、冲四等关键节奏。'
        ];

        sections.push('分析步骤提示：① 快速枚举对手本回合及下一回合的必杀威胁；② 评估己方在候选点中形成主动攻势的线路；③ 综合短期安全与长线布局后再定夺。若存在临界威胁，先说明如何处置。');
        sections.push('输出要求：{"move":{"x":行索引0-14,"y":列索引0-14},"analysis":"攻:xx; 守:xx","banter":"8到16字，幽默自嘲自己是大师AI"}');
        sections.push('analysis 字段中的 "攻" 与 "守" 各不超过 16 字，需明确攻守要点，也要注明若有备选或残留风险。若候选列表没有完美落点，亦必须从中选取最优项并说明取舍依据。请严格依据上方棋盘与历史落子判断，不得假设棋子位置。请直接以 { 开头输出 JSON，回复中不得出现额外说明、前言或 reasoning 文字。');

        return sections.join('\n\n');
    },

    formatBoardForPrompt() {
        const header = Array.from({ length: this.boardSize })
            .map((_, index) => index.toString().padStart(2, ' '))
            .join(' ');
        const lines = [`   ${header}`];

        for (let i = 0; i < this.boardSize; i++) {
            const rowCells = [];
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.board[i][j];
                if (cell === 'black') {
                    rowCells.push('B');
                } else if (cell === 'white') {
                    rowCells.push('W');
                } else {
                    rowCells.push('.');
                }
            }
            lines.push(`${i.toString().padStart(2, ' ')} ${rowCells.map((symbol) => symbol.padStart(2, ' ')).join(' ')}`);
        }

        return lines.join('\n');
    },

    formatRecentMovesForPrompt(limit = 6) {
        if (!Array.isArray(this.moveHistory) || this.moveHistory.length === 0) {
            return '暂无历史记录，当前为开局阶段。';
        }

        const start = Math.max(0, this.moveHistory.length - limit);
        const slices = this.moveHistory.slice(start);
        return slices
            .map((move, index) => {
                const moveNumber = start + index + 1;
                const color = move.player === 'black' ? '黑' : '白';
                return `${moveNumber}. ${color} (${move.x}, ${move.y})`;
            })
            .join('\n');
    },

    formatLegalMovesForPrompt(aiPlayer, limit) {
        const player = aiPlayer || this.aiPlayer || this.currentPlayer || 'black';
        const opponent = this.getOpponent(player);
        const maxLimit = typeof limit === 'number' ? limit : this.boardSize * this.boardSize;
        const seen = new Set();
        const results = [];
        this.grandmasterLegalMoves = new Set();

        const pushMove = (x, y) => {
            const key = `${x},${y}`;
            if (seen.has(key)) {
                return;
            }
            if (this.board[x][y] !== null) {
                return;
            }
            seen.add(key);
            results.push({ x, y });
            this.grandmasterLegalMoves.add(key);
        };

        // 优先加入本地判定的关键战术点，减少模型偏离主线的概率。
        const aiWinningMoves = this.getImmediateWinningMoves(player, 2);
        for (const move of aiWinningMoves) {
            pushMove(move.x, move.y);
            if (results.length >= maxLimit) {
                break;
            }
        }

        if (results.length < maxLimit) {
            const blockWinningMoves = this.getImmediateWinningMoves(opponent, 2);
            for (const move of blockWinningMoves) {
                pushMove(move.x, move.y);
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length < maxLimit) {
            const urgentDefense = this.findUrgentThreatMoves(opponent, 7600, 3);
            for (const move of urgentDefense.slice(0, 8)) {
                pushMove(move.x, move.y);
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length < maxLimit) {
            const urgentAttack = this.findUrgentThreatMoves(player, 8400, 3);
            for (const move of urgentAttack.slice(0, 8)) {
                pushMove(move.x, move.y);
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length < maxLimit) {
            const ranked = this.getCandidateMoves(2)
                .map(({ x, y }) => ({
                    x,
                    y,
                    score: this.evaluateAdvancedPositionForPlayer(x, y, player, {
                        centerWeight: 52,
                        offensiveMultiplier: 1.45,
                        defensiveMultiplier: 0.58,
                        adjacencyWeight: 78,
                        adjacencyRadius: 2,
                        threatWeight: 1.2,
                        forkWeight: 1.1,
                        defensiveThreatWeight: 0.72,
                        defensiveForkWeight: 0.66
                    })
                }))
                .sort((a, b) => b.score - a.score);

            for (const move of ranked.slice(0, 16)) {
                pushMove(move.x, move.y);
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        const coreCandidates = this.getCandidateMoves(2);
        for (const move of coreCandidates) {
            pushMove(move.x, move.y);
            if (results.length >= maxLimit) {
                break;
            }
        }

        if (results.length < maxLimit) {
            const expanded = this.getCandidateMoves(3);
            for (const move of expanded) {
                pushMove(move.x, move.y);
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length < Math.min(maxLimit, 12)) {
            const center = Math.floor(this.boardSize / 2);
            pushMove(center, center);
            const neighborOffsets = [
                [0, 1], [1, 0], [0, -1], [-1, 0],
                [1, 1], [1, -1], [-1, 1], [-1, -1]
            ];
            for (const [dx, dy] of neighborOffsets) {
                const nx = center + dx;
                const ny = center + dy;
                if (this.isInsideBoard(nx, ny)) {
                    pushMove(nx, ny);
                }
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length < maxLimit) {
            for (let i = 0; i < this.boardSize; i++) {
                for (let j = 0; j < this.boardSize; j++) {
                    if (this.board[i][j] === null) {
                        pushMove(i, j);
                        if (results.length >= maxLimit) {
                            break;
                        }
                    }
                }
                if (results.length >= maxLimit) {
                    break;
                }
            }
        }

        if (results.length === 0) {
            return '无可落子点。';
        }

        const lines = [];
        const chunkSize = 10;
        for (let i = 0; i < results.length; i += chunkSize) {
            const chunk = results
                .slice(i, i + chunkSize)
                .map(({ x, y }) => `(${x}, ${y})`)
                .join('、');
            lines.push(chunk);
        }

        return lines.join('\n');
    },

    formatStrategicHintsForPrompt(aiPlayer) {
        const player = aiPlayer || this.aiPlayer || this.currentPlayer || 'black';
        const opponent = this.getOpponent(player);
        const hints = [];

        const winningMoves = this.getImmediateWinningMoves(player, 2);
        if (winningMoves.length > 0) {
            const text = winningMoves.slice(0, 3).map(({ x, y }) => `(${x}, ${y})`).join('、');
            hints.push(`己方即杀点：${text}`);
        }

        const opponentWins = this.getImmediateWinningMoves(opponent, 2);
        if (opponentWins.length > 0) {
            const text = opponentWins.slice(0, 4).map(({ x, y }) => `(${x}, ${y})`).join('、');
            hints.push(`必须防守点：${text}`);
        }

        const urgentDefense = this.findUrgentThreatMoves(opponent, 7600, 3);
        if (urgentDefense.length > 0) {
            const text = urgentDefense
                .slice(0, 4)
                .map(({ x, y, severity }) => `(${x}, ${y})@${Math.round(severity)}`)
                .join('、');
            hints.push(`对手高压点：${text}`);
        }

        const urgentAttack = this.findUrgentThreatMoves(player, 8400, 3);
        if (urgentAttack.length > 0) {
            const text = urgentAttack
                .slice(0, 3)
                .map(({ x, y, severity }) => `(${x}, ${y})@${Math.round(severity)}`)
                .join('、');
            hints.push(`己方先手点：${text}`);
        }

        if (hints.length === 0) {
            hints.push('暂无绝对先手，优先兼顾中心与联络。');
        }

        return hints.join('\n');
    },

    formatThreatSummaryForPrompt() {
        const players = ['black', 'white'];
        const labels = {
            black: '黑棋',
            white: '白棋'
        };
        const lines = [];

        for (const player of players) {
            const summary = this.scanThreatsOnBoard(player);
            const parts = [];

            if (summary.openFours.length > 0) {
                const points = this.formatThreatOpenCells(summary.openFours, 3);
                parts.push(`活四 ${summary.openFours.length} 组→${points}`);
            }
            if (summary.semiOpenFours.length > 0) {
                const points = this.formatThreatOpenCells(summary.semiOpenFours, 3);
                parts.push(`冲四 ${summary.semiOpenFours.length} 组→${points}`);
            }
            if (summary.openThrees.length > 0) {
                const points = this.formatThreatOpenCells(summary.openThrees, 3);
                parts.push(`活三 ${summary.openThrees.length} 组→${points}`);
            }
            if (summary.semiOpenThrees.length > 0) {
                const points = this.formatThreatOpenCells(summary.semiOpenThrees, 3);
                parts.push(`眠三 ${summary.semiOpenThrees.length} 组→${points}`);
            }

            if (parts.length === 0) {
                parts.push('暂无显著威胁');
            }

            lines.push(`${labels[player]}：${parts.join('；')}`);
        }

        return lines.join('\n');
    },

    formatThreatOpenCells(threats, limit = 3) {
        const cells = [];
        const seen = new Set();

        for (const threat of threats) {
            if (!Array.isArray(threat.openCells)) {
                continue;
            }
            for (const cell of threat.openCells) {
                const key = `${cell.x},${cell.y}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                cells.push(`(${cell.x}, ${cell.y})`);
                if (cells.length >= limit) {
                    return cells.join('、');
                }
            }
        }

        return cells.length > 0 ? cells.join('、') : '关键点待补';
    },

    scanThreatsOnBoard(player) {
        const directions = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1]
        ];

        const summary = {
            openFours: [],
            semiOpenFours: [],
            openThrees: [],
            semiOpenThrees: []
        };

        for (let x = 0; x < this.boardSize; x++) {
            for (let y = 0; y < this.boardSize; y++) {
                if (this.board[x][y] !== player) {
                    continue;
                }

                for (const [dx, dy] of directions) {
                    const prevX = x - dx;
                    const prevY = y - dy;
                    if (this.isInsideBoard(prevX, prevY) && this.board[prevX][prevY] === player) {
                        continue;
                    }

                    const line = this.collectLineFromOrigin(x, y, dx, dy, player);
                    if (!line) {
                        continue;
                    }

                    const { length, openEnds, openCells } = line;

                    if (length === 4) {
                        if (openEnds === 2) {
                            summary.openFours.push(line);
                        } else if (openEnds === 1) {
                            summary.semiOpenFours.push(line);
                        }
                    } else if (length === 3) {
                        if (openEnds === 2) {
                            summary.openThrees.push(line);
                        } else if (openEnds === 1) {
                            summary.semiOpenThrees.push(line);
                        }
                    }
                }
            }
        }

        return summary;
    },

    collectLineFromOrigin(x, y, dx, dy, player) {
        let length = 0;
        const stones = [];
        let cx = x;
        let cy = y;

        while (this.isInsideBoard(cx, cy) && this.board[cx][cy] === player) {
            stones.push({ x: cx, y: cy });
            length++;
            cx += dx;
            cy += dy;
        }

        let openEnds = 0;
        const openCells = [];

        if (this.isInsideBoard(cx, cy) && this.board[cx][cy] === null) {
            openEnds++;
            openCells.push({ x: cx, y: cy });
        }

        const backX = x - dx;
        const backY = y - dy;
        if (this.isInsideBoard(backX, backY) && this.board[backX][backY] === null) {
            openEnds++;
            openCells.push({ x: backX, y: backY });
        }

        return {
            length,
            openEnds,
            stones,
            openCells
        };
    },

    parseLlmMove(rawContent) {
        if (!rawContent || typeof rawContent !== 'string') {
            return null;
        }

        const trimmed = rawContent.trim();
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            return null;
        }

        const jsonText = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            const parsed = JSON.parse(jsonText);
            const moveNode = parsed.move || parsed;
            if (!moveNode) {
                return null;
            }

            const rawX = moveNode.x ?? moveNode.row;
            const rawY = moveNode.y ?? moveNode.col;

            const x = Number(rawX);
            const y = Number(rawY);

            if (Number.isInteger(x) && Number.isInteger(y) && this.isInsideBoard(x, y)) {
                const key = `${x},${y}`;
                if (this.grandmasterLegalMoves instanceof Set && this.grandmasterLegalMoves.size > 0 && !this.grandmasterLegalMoves.has(key)) {
                    return null;
                }
                const banter = typeof parsed.banter === 'string' ? parsed.banter.trim() : '';
                const analysis = typeof parsed.analysis === 'string' ? parsed.analysis.trim() : '';
                return { x, y, banter, analysis };
            }
        } catch (error) {
            console.error('Failed to parse LLM move:', error);
        }

        return null;
    },

    isGrandmasterCandidate(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return false;
        }
        if (!this.isInsideBoard(x, y)) {
            return false;
        }
        if (this.board[x][y] !== null) {
            return false;
        }
        if (this.grandmasterLegalMoves instanceof Set && this.grandmasterLegalMoves.size > 0) {
            return this.grandmasterLegalMoves.has(`${x},${y}`);
        }
        return true;
    },

    isCellAvailable(x, y) {
        return this.isInsideBoard(x, y) && this.board[x][y] === null;
    },

    evaluateGrandmasterCandidateScore(aiPlayer, x, y) {
        if (!this.isInsideBoard(x, y) || this.board[x][y] !== null) {
            return -Infinity;
        }

        const opponent = this.getOpponent(aiPlayer);
        this.board[x][y] = aiPlayer;
        const immediateWin = this.checkWin(x, y);
        if (immediateWin) {
            this.board[x][y] = null;
            return 500000;
        }

        const baseScore = this.evaluateAdvancedPositionForPlayer(x, y, aiPlayer, {
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
        const lineStats = this.collectLineStats(x, y, aiPlayer);
        const profile = this.getThreatProfile(lineStats);
        const forcingSeverity = this.evaluateOffenseSeverity(profile);
        const forkBonus = this.calculateForkBonus(lineStats);
        const pressureScore = this.calculateOffensivePressure(lineStats);
        const chainPotential = this.calculateChainPotential(lineStats);
        const boardAdvantage = this.evaluateBoardAdvantage(aiPlayer);
        const lookahead = this.minimaxSearch(2, -Infinity, Infinity, opponent, aiPlayer, 2);
        const riskPenalty = this.evaluateCounterThreatRisk(aiPlayer, opponent);
        this.board[x][y] = null;

        const lookaheadScore = Number.isFinite(lookahead) ? lookahead : 0;
        return lookaheadScore * 0.55
            + baseScore * 0.35
            + forcingSeverity * 2.2
            + forkBonus * 0.008
            + pressureScore * 0.5
            + chainPotential * 0.65
            + boardAdvantage * 0.45
            + riskPenalty;
    },

    stabilizeGrandmasterMove(aiPlayer, move) {
        if (!move || !Number.isInteger(move.x) || !Number.isInteger(move.y)) {
            return null;
        }

        const { x, y } = move;
        if (!this.isGrandmasterCandidate(x, y)) {
            return null;
        }

        const llmScore = this.evaluateGrandmasterCandidateScore(aiPlayer, x, y);
        if (!Number.isFinite(llmScore)) {
            return null;
        }

        const hardMove = this.getHardMove(aiPlayer);
        if (!hardMove || !Number.isInteger(hardMove.x) || !Number.isInteger(hardMove.y)) {
            return { x, y };
        }

        if (hardMove.x === x && hardMove.y === y) {
            return { x, y };
        }

        const hardScore = this.evaluateGrandmasterCandidateScore(aiPlayer, hardMove.x, hardMove.y);
        if (!Number.isFinite(hardScore)) {
            return { x, y };
        }

        const unsafeThreshold = -90000;
        const replacementMargin = 4200;
        if (llmScore <= unsafeThreshold || hardScore > llmScore + replacementMargin) {
            return { x: hardMove.x, y: hardMove.y };
        }

        return { x, y };
    },

    normalizeLlmEndpoint(endpoint) {
        if (!endpoint || typeof endpoint !== 'string') {
            return '';
        }

        const trimmed = endpoint.trim();
        if (!trimmed) {
            return '';
        }

        const withoutSlash = trimmed.replace(/\/$/, '');
        const lower = withoutSlash.toLowerCase();

        if (lower.endsWith('/chat/completions') || lower.endsWith('/completions')) {
            return withoutSlash;
        }

        return `${withoutSlash}/chat/completions`;
    },

    shouldRequireApiKey(endpoint) {
        if (!endpoint || typeof endpoint !== 'string') {
            return true;
        }

        try {
            const provisional = endpoint.includes('://') ? endpoint : `https://${endpoint}`;
            const url = new URL(provisional);
            const host = url.hostname.toLowerCase();
            if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
                return false;
            }
            if (host === '::1' || host === '[::1]') {
                return false;
            }
            if (host.endsWith('.local')) {
                return false;
            }
        } catch (error) {
            if (/localhost|127\.0\.0\.1|::1/.test(endpoint)) {
                return false;
            }
        }

        return true;
    },

    extractLlmMessageContent(payload) {
        if (!payload) {
            return '';
        }

        const extractContent = (value) => {
            if (!value) {
                return '';
            }
            if (typeof value === 'string') {
                return value;
            }
            if (Array.isArray(value)) {
                return value
                    .map((item) => extractContent(
                        typeof item === 'string'
                            ? item
                            : item && (
                                item.text
                                ?? item.content
                                ?? item.value
                                ?? item.message
                                ?? item.reasoning
                                ?? item.data
                                ?? item.function?.arguments
                            )
                    ))
                    .join('');
            }
            if (typeof value === 'object') {
                if (typeof value.data === 'string') {
                    return value.data;
                }
                if (Array.isArray(value.data)) {
                    return extractContent(value.data);
                }
                if (value.data && typeof value.data === 'object') {
                    const dataValue = extractContent(value.data.text
                        ?? value.data.content
                        ?? value.data.value
                        ?? value.data.message
                        ?? value.data.reasoning
                        ?? value.data.arguments
                    );
                    if (dataValue) {
                        return dataValue;
                    }
                }
                if (typeof value.content === 'string') {
                    return value.content;
                }
                if (Array.isArray(value.content)) {
                    return extractContent(value.content);
                }
                if (typeof value.text === 'string') {
                    return value.text;
                }
                if (Array.isArray(value.text)) {
                    return extractContent(value.text);
                }
                if (typeof value.value === 'string') {
                    return value.value;
                }
                if (typeof value.message === 'string') {
                    return value.message;
                }
                if (typeof value.reasoning === 'string') {
                    return value.reasoning;
                }
                if (Array.isArray(value.reasoning)) {
                    return extractContent(value.reasoning);
                }
                if (value.function && typeof value.function.arguments === 'string') {
                    return value.function.arguments;
                }
            }
            return '';
        };

        if (Array.isArray(payload.choices)) {
            for (const choice of payload.choices) {
                const contentSources = [
                    choice?.message,
                    choice?.delta,
                    choice?.content,
                    choice?.text
                ];
                for (const source of contentSources) {
                    const extracted = extractContent(source);
                    if (extracted) {
                        return extracted;
                    }
                }
                if (Array.isArray(choice?.message?.tool_calls)) {
                    for (const call of choice.message.tool_calls) {
                        const extracted = extractContent(call?.function?.arguments);
                        if (extracted) {
                            return extracted;
                        }
                    }
                }
                if (choice?.message?.function_call && typeof choice.message.function_call.arguments === 'string') {
                    return choice.message.function_call.arguments;
                }
            }
        }

        const fallbacks = [payload.output, payload.message, payload.data, payload.result];
        for (const candidate of fallbacks) {
            const extracted = extractContent(candidate);
            if (extracted) {
                return extracted;
            }
        }

        return '';
    },

    updateLlmTestButtonState() {
        const testButton = document.getElementById('llm-test');
        if (!testButton) {
            return;
        }
        const isGrandmasterActive = this.gameMode === 'pve' && this.difficulty === 'grandmaster';
        if (!isGrandmasterActive) {
            testButton.disabled = true;
            this.updateLlmConfigStatus();
            return;
        }

        const { endpoint, apiKey, model, thinkingEnabled, reasoningEffort } = this.llmConfig;
        const requiresApiKey = this.shouldRequireApiKey(endpoint);
        const ready = Boolean(endpoint && model && (!requiresApiKey || apiKey));
        const busy = this.llmTestInFlight || this.llmRequestInFlight;
        testButton.disabled = !ready || busy;
        const effortSelect = document.getElementById('llm-reasoning-effort');
        if (effortSelect) {
            effortSelect.disabled = thinkingEnabled === false || busy;
            effortSelect.value = reasoningEffort === 'max' ? 'max' : 'high';
        }
        this.updateLlmConfigStatus();
    },

    updateLlmConfigStatus(statusOverride = '') {
        const statusNode = document.getElementById('llm-config-status');
        if (!statusNode) {
            return;
        }

        statusNode.className = 'llm-config-status';

        const isGrandmasterActive = this.gameMode === 'pve' && this.difficulty === 'grandmaster';
        if (!isGrandmasterActive) {
            statusNode.textContent = '选择大模型难度后填写配置';
            return;
        }

        if (statusOverride === 'testing') {
            statusNode.textContent = '正在测试连接，请稍候';
            statusNode.classList.add('busy');
            return;
        }

        if (statusOverride === 'thinking') {
            statusNode.textContent = '大模型正在推演，本次请求可被悔棋或新游戏取消';
            statusNode.classList.add('busy');
            return;
        }

        if (statusOverride === 'ok') {
            statusNode.textContent = '连接正常，可以开始大模型对局';
            statusNode.classList.add('ready');
            return;
        }

        if (statusOverride === 'error') {
            statusNode.textContent = '连接失败，请核对端点、密钥、模型名称或网络';
            statusNode.classList.add('error');
            return;
        }

        if (this.llmTestInFlight) {
            statusNode.textContent = '正在测试连接，请稍候';
            statusNode.classList.add('busy');
            return;
        }

        if (this.llmRequestInFlight) {
            statusNode.textContent = '大模型正在推演，本次请求可被悔棋或新游戏取消';
            statusNode.classList.add('busy');
            return;
        }

        if (this.llmConfigStatus === 'ok') {
            statusNode.textContent = '连接正常，可以开始大模型对局';
            statusNode.classList.add('ready');
            return;
        }

        if (this.llmConfigStatus === 'error') {
            statusNode.textContent = '连接失败，请核对端点、密钥、模型名称或网络';
            statusNode.classList.add('error');
            return;
        }

        const { endpoint, apiKey, model, thinkingEnabled, reasoningEffort } = this.llmConfig;
        const requiresApiKey = this.shouldRequireApiKey(endpoint);
        if (!endpoint || !model || (requiresApiKey && !apiKey)) {
            const missing = [];
            if (!endpoint) {
                missing.push('端点');
            }
            if (!model) {
                missing.push('模型名称');
            }
            if (requiresApiKey && !apiKey) {
                missing.push('API 密钥');
            }
            statusNode.textContent = `待填写：${missing.join('、')}`;
            return;
        }

        const thinkingText = thinkingEnabled === false
            ? '思考关闭'
            : `思考开启，强度 ${reasoningEffort === 'max' ? 'Max' : 'High'}`;
        statusNode.textContent = `配置完整，可测试连接；${thinkingText}`;
        statusNode.classList.add('ready');
    },

    async testLlmConnection() {
        if (this.llmTestInFlight) {
            this.showInfoMessage('测试进行中，请稍候…');
            return;
        }

        if (this.llmRequestInFlight) {
            window.alert('AI 正在等待大模型响应，请稍后测试。');
            return;
        }

        if (this.messageState === 'thinking') {
            window.alert('AI 正在思考当前回合，稍后再试。');
            return;
        }

        const { endpoint, apiKey, model } = this.llmConfig;
        const requiresApiKey = this.shouldRequireApiKey(endpoint);
        if (!endpoint || !model || (requiresApiKey && !apiKey)) {
            this.showInfoMessage('请先填写完整的端点、模型名称，以及必要时的访问密钥。');
            return;
        }

        const requestUrl = this.normalizeLlmEndpoint(endpoint);
        if (!requestUrl) {
            this.showInfoMessage('无法识别的大模型端点，请检查格式。');
            return;
        }

        this.llmTestInFlight = true;
        this.updateLlmTestButtonState();
        this.updateLlmConfigStatus('testing');
        this.showInfoMessage('正在测试大模型连通性…');

        const payload = this.withThinkingOptions({
            model,
            temperature: 0.1,
            max_tokens: 128,
            stream: false,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: '你是一位连通性检测助手，请直接返回 {"status":"ok"}。'
                },
                {
                    role: 'user',
                    content: '仅用于测试，请直接返回 {"status":"ok"}，不要附加其他内容。'
                }
            ]
        });

        try {
            const { data } = await this.postChatCompletion(requestUrl, payload, apiKey, {
                timeoutMs: this.llmRequestTimeoutMs
            });
            const content = (this.extractLlmMessageContent(data) || '').trim();
            if (/"status"\s*:\s*"ok"/i.test(content)) {
                this.showInfoMessage('大模型连接正常，可开始对局。');
                this.llmConfigStatus = 'ok';
                this.updateLlmConfigStatus('ok');
            } else if (content.length > 0) {
                this.showInfoMessage('已收到响应，请确认模型输出格式。');
                this.llmConfigStatus = 'ok';
                this.updateLlmConfigStatus('ok');
            } else {
                this.showInfoMessage('收到空响应，请确认模型使用 Chat Completions 协议且已禁用流式输出。');
                this.llmConfigStatus = 'error';
                this.updateLlmConfigStatus('error');
            }
        } catch (error) {
            console.error('LLM connectivity test failed:', error);
            this.showInfoMessage('测试超时或失败，请核对端点、密钥或网络。');
            this.llmConfigStatus = 'error';
            this.updateLlmConfigStatus('error');
        } finally {
            this.llmTestInFlight = false;
            this.updateLlmTestButtonState();
        }
    },

    async postChatCompletion(requestUrl, payload, apiKey, options = {}) {
        const { allowResponseFormatRetry = true, signal = null, timeoutMs = 20000 } = options || {};
        const headers = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const perform = async (body) => {
            const requestController = new AbortController();
            let timeoutId = null;
            const abortRequest = () => {
                requestController.abort();
            };

            if (signal) {
                if (signal.aborted) {
                    requestController.abort();
                } else {
                    signal.addEventListener('abort', abortRequest, { once: true });
                }
            }

            if (timeoutMs > 0) {
                timeoutId = window.setTimeout(() => {
                    requestController.abort();
                }, timeoutMs);
            }

            try {
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: requestController.signal
                });
                const rawText = await response.text();
                let data = null;
                if (rawText) {
                    try {
                        data = JSON.parse(rawText);
                    } catch {
                        data = null;
                    }
                    if (!data && /"reasoning"\s*?:/.test(rawText)) {
                        data = { choices: [{ message: { reasoning: rawText } }] };
                    }
                }
                return { response, rawText, data };
            } finally {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
                if (signal) {
                    signal.removeEventListener('abort', abortRequest);
                }
            }
        };

        let attempt = await perform(payload);

        const shouldRetryWithoutFormat = allowResponseFormatRetry && payload && payload.response_format && (!attempt.response.ok) && (
            attempt.response.status === 400 || attempt.response.status === 404 || /response[_-]?format/i.test(attempt.rawText)
        );

        if (shouldRetryWithoutFormat) {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.response_format;
            attempt = await perform(fallbackPayload);
        }

        if (!attempt.response.ok) {
            const error = new Error(`LLM request failed with status ${attempt.response.status}`);
            error.status = attempt.response.status;
            error.body = attempt.rawText;
            throw error;
        }

        if (!attempt.data) {
            const error = new Error('LLM 响应为空或不是有效 JSON');
            error.status = attempt.response.status;
            error.body = attempt.rawText;
            throw error;
        }

        return attempt;
    },

    extractGrandmasterResponse(data) {
        if (!data) {
            return null;
        }

        const extractedContent = this.extractLlmMessageContent(data);
        const hasDirectContent = Array.isArray(data?.choices)
            && data.choices.some((choice) => {
                const msg = choice?.message;
                if (!msg) {
                    return false;
                }
                if (typeof msg.content === 'string' && msg.content.trim().length > 0) {
                    return true;
                }
                if (Array.isArray(msg.content)) {
                    return msg.content.some((segment) => typeof segment === 'string' ? segment.trim().length > 0 : typeof segment?.text === 'string' && segment.text.trim().length > 0);
                }
                return false;
            });

        const shouldUseExtractedContent = extractedContent && (hasDirectContent || this.llmConfig.useReasoningFallback !== false);

        if (shouldUseExtractedContent) {
            const parsed = this.parseLlmMove(extractedContent);
            if (parsed) {
                return {
                    move: { x: parsed.x, y: parsed.y },
                    analysis: parsed.analysis,
                    banter: parsed.banter
                };
            }
        }

        if (Array.isArray(data.choices)) {
            for (const choice of data.choices) {
                const toolCalls = choice?.message?.tool_calls;
                if (!Array.isArray(toolCalls)) {
                    continue;
                }
                for (const toolCall of toolCalls) {
                    if (!toolCall || toolCall.type !== 'function') {
                        continue;
                    }
                    const fn = toolCall.function;
                    if (!fn || fn.name !== 'submit_move') {
                        continue;
                    }
                    try {
                        const args = fn.arguments ? JSON.parse(fn.arguments) : null;
                        if (args && Number.isInteger(args.x) && Number.isInteger(args.y)) {
                            return {
                                move: { x: args.x, y: args.y },
                                analysis: typeof args.analysis === 'string' ? args.analysis : '',
                                banter: typeof args.banter === 'string' ? args.banter : ''
                            };
                        }
                    } catch (error) {
                        console.error('Failed to parse tool call arguments:', error);
                    }
                }
            }
        }

        if (this.llmConfig.useReasoningFallback !== false) {
            const reasoningText = this.extractReasoningText(data);
            if (reasoningText) {
                const parsed = this.parseLlmMove(reasoningText);
                if (parsed) {
                    return {
                        move: { x: parsed.x, y: parsed.y },
                        analysis: parsed.analysis,
                        banter: parsed.banter
                    };
                }

                const extractedFromText = this.extractMoveFromReasoningText(reasoningText);
                if (extractedFromText) {
                    return extractedFromText;
                }
            }
        }

        return null;
    },

    extractReasoningText(payload) {
        if (!payload) {
            return '';
        }

        const collectReasoning = (node) => {
            if (!node) {
                return '';
            }
            if (typeof node === 'string') {
                return node;
            }
            if (Array.isArray(node)) {
                return node.map((inner) => collectReasoning(inner)).join('');
            }
            if (typeof node === 'object') {
                let combined = '';
                if (typeof node.reasoning === 'string') {
                    combined += node.reasoning;
                }
                if (Array.isArray(node.reasoning)) {
                    combined += collectReasoning(node.reasoning);
                }
                const keys = ['value', 'text', 'content', 'message', 'data'];
                for (const key of keys) {
                    if (node[key]) {
                        combined += collectReasoning(node[key]);
                    }
                }
                return combined;
            }
            return '';
        };

        if (Array.isArray(payload.choices)) {
            for (const choice of payload.choices) {
                const reasoning = collectReasoning(choice?.message);
                if (reasoning) {
                    return reasoning;
                }
            }
        }

        return '';
    },

    extractMoveFromReasoningText(text) {
        if (typeof text !== 'string' || text.length === 0) {
            return null;
        }

        if (this.llmConfig.useReasoningFallback === false) {
            return null;
        }

        const coordinateCandidates = [];
        const pairRegex = /[（(]\s*(\d{1,2})\s*[，,]\s*(\d{1,2})\s*[）)]/g;
        let match;
        while ((match = pairRegex.exec(text)) !== null) {
            const x = Number(match[1]);
            const y = Number(match[2]);
            coordinateCandidates.push({ x, y });
        }

        const assignmentRegex = /x\s*[:=]\s*(\d{1,2})[^\d]{0,10}y\s*[:=]\s*(\d{1,2})/gi;
        while ((match = assignmentRegex.exec(text)) !== null) {
            const x = Number(match[1]);
            const y = Number(match[2]);
            coordinateCandidates.push({ x, y });
        }

        const uniqueCandidates = [];
        const seen = new Set();
        for (const candidate of coordinateCandidates) {
            const key = `${candidate.x},${candidate.y}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            if (this.isGrandmasterCandidate(candidate.x, candidate.y)) {
                uniqueCandidates.push(candidate);
            }
        }

        if (uniqueCandidates.length === 0) {
            return null;
        }

        const buildAnalysis = () => {
            const attackMatch = text.match(/攻[:：]\s*([^；;\n]{1,24})/);
            const defenseMatch = text.match(/守[:：]\s*([^；;\n]{1,24})/);
            const attack = attackMatch ? attackMatch[1].trim() : '中心续攻';
            const defense = defenseMatch ? defenseMatch[1].trim() : '防对手延伸';
            return `攻:${attack.slice(0, 16)}; 守:${defense.slice(0, 16)}`;
        };

        const buildBanter = () => {
            const candidates = [
                '大师AI又卡壳啦啦',
                '大师AI脑袋发胀',
                '大师AI稍微震颤'
            ];
            return candidates[Math.floor(Math.random() * candidates.length)];
        };

        const selected = uniqueCandidates[0];
        return {
            move: { x: selected.x, y: selected.y },
            analysis: buildAnalysis(),
            banter: buildBanter()
        };
    }
});
