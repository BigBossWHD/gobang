// 后台线程只计算棋步，不创建界面，也不接收 API 密钥。
self.window = self;
importScripts('script.js?v=20261008-6', 'ai.js?v=20261008-6');
self.onmessage = event => {
    const { board, moveHistory, aiPlayer } = event.data;
    const game = Object.create(GomokuGame.prototype);
    Object.assign(game, { boardSize: board.length, board, moveHistory, aiPlayer });
    self.postMessage(game.getHardMove(aiPlayer));
};
