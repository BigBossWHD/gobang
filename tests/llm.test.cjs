const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(saved, fetchImpl) {
    const storage = new Map(saved ? [['gomoku.llmConfig', JSON.stringify(saved)]] : []);
    const context = vm.createContext({ console: { error() {}, warn() {} }, performance, AbortController, URL, Set, Map, fetch: fetchImpl,
        window: { setTimeout, clearTimeout, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } } });
    for (const file of ['script.js', 'ai.js', 'llm.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    }
    const Game = context.window.GomokuGame;
    for (const method of ['bindEvents', 'renderBoard', 'initModal', 'initSettingsPanel', 'updateLlmTestButtonState']) {
        Game.prototype[method] = () => {};
    }
    return { game: new Game(), storage, context };
}

test('默认模型、思考和 Max 均进入真实请求载荷', () => {
    const { game } = setup();
    const payload = game.buildGrandmasterRequestPayload('white');
    assert.equal(payload.model, 'deepseek-flash');
    assert.equal(payload.thinking.type, 'enabled');
    assert.equal(payload.reasoning_effort, 'max');
    assert.equal(game.llmRequestTimeoutMs, 120000);
    assert.equal(payload.temperature, undefined);
});

test('旧配置迁移清除保存的密钥，并保留个人设置', () => {
    const { game, storage } = setup({ endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash',
        apiKey: 'test-secret', thinkingEnabled: false, reasoningEffort: 'high' });
    assert.equal(game.llmConfig.model, 'deepseek-flash');
    assert.equal(game.llmConfig.apiKey, '');
    assert.equal(game.llmConfig.thinkingEnabled, false);
    assert.equal(game.llmConfig.reasoningEffort, 'high');
    assert.equal(JSON.parse(storage.get('gomoku.llmConfig')).apiKey, undefined);
    game.llmConfig.apiKey = 'new-test-secret';
    game.persistLlmConfig();
    assert.ok(!storage.get('gomoku.llmConfig').includes('secret'));
});

test('第三方模型名保持不变', () => {
    const { game } = setup({ endpoint: 'https://proxy.example/v1', model: 'deepseek-v4-flash' });
    assert.equal(game.llmConfig.model, 'deepseek-v4-flash');
});

const waitForAbort = (_url, { signal }) => new Promise((_resolve, reject) => {
    const abort = () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
});

test('定时超时被识别为 TimeoutError', async () => {
    const { game } = setup(null, waitForAbort);
    await assert.rejects(game.postChatCompletion('/test', {}, '', { timeoutMs: 5 }), { name: 'TimeoutError' });
});

test('主动取消保持 AbortError，不误当超时', async () => {
    const { game } = setup(null, waitForAbort);
    const controller = new AbortController();
    const pending = game.postChatCompletion('/test', {}, '', { signal: controller.signal, timeoutMs: 100 });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
});

function mockTurn(game) {
    game.llmConfig.apiKey = 'test-only';
    for (const method of ['buildGrandmasterRequestPayload', 'buildGrandmasterFallbackPayload', 'buildGrandmasterToolCallPayload']) {
        game[method] = () => ({});
    }
    game.updateLlmConfigStatus = () => {};
    game.showInfoMessage = text => { game.lastMessage = text; };
    game.getHardMoveAsync = async () => ({ x: 7, y: 7 });
}

test('对局请求超时会落本地棋，释放请求状态', async () => {
    const { game } = setup();
    mockTurn(game);
    game.postChatCompletion = async () => { const error = new Error(); error.name = 'TimeoutError'; throw error; };
    const move = await game.getGrandmasterMove('white');
    assert.deepEqual(move, { x: 7, y: 7 });
    assert.match(game.lastMessage, /超时/);
    assert.equal(game.llmRequestInFlight, false);
});

test('重开取消的旧请求不会覆盖新局提示或落子', async () => {
    const { game } = setup();
    mockTurn(game);
    game.postChatCompletion = async () => {
        game.cancelOngoingLlmRequest();
        const error = new Error(); error.name = 'AbortError'; throw error;
    };
    assert.equal(await game.getGrandmasterMove('white'), null);
    assert.equal(game.lastMessage, undefined);
});

test('函数调用返回候选外坐标时拒绝采用', async () => {
    const { game } = setup();
    mockTurn(game);
    game.grandmasterLegalMoves = new Set(['7,7']);
    game.postChatCompletion = async () => ({ data: { choices: [{ message: { tool_calls: [{ type: 'function',
        function: { name: 'submit_move', arguments: '{"x":1,"y":1}' } }] } }] } });
    assert.deepEqual(await game.getGrandmasterMove('white'), { x: 7, y: 7 });
    assert.match(game.lastMessage, /无法落子/);
});


test('连通性错误区分认证、余额、超时和网络，且不显示原始正文', () => {
    const { game } = setup();
    for (const [status, expected] of [[401, /密钥验证失败/], [402, /余额不足/], [429, /过于频繁/], [503, /服务暂时异常/]]) {
        const text = game.describeLlmConnectionError({ status, body: 'sensitive-response', message: 'sensitive-response' });
        assert.match(text, expected);
        assert.ok(!text.includes('sensitive-response'));
    }
    assert.match(game.describeLlmConnectionError({ name: 'TimeoutError' }), /120 秒/);
    assert.match(game.describeLlmConnectionError(new TypeError('Failed to fetch')), /网络、代理或跨域/);
});

test('测试失败的具体原因保留给状态面板，且释放按钮', async () => {
    const { game } = setup();
    game.llmConfig.apiKey = 'test-only';
    game.showInfoMessage = text => { game.lastMessage = text; };
    game.updateLlmConfigStatus = () => {};
    game.postChatCompletion = async () => { throw { status: 401 }; };
    await game.testLlmConnection();
    assert.match(game.lastMessage, /401/);
    assert.equal(game.llmConnectionError, game.lastMessage);
    assert.equal(game.llmTestInFlight, false);
});
