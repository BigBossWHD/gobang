// 游戏初始化
const initializeGomoku = () => {
    try {
        window.gomokuGame = new GomokuGame();
    } catch (error) {
        console.error('Failed to initialize Gomoku game:', error);
        const message = document.getElementById('message');
        if (message) {
            message.textContent = `游戏初始化失败：${error.message || '请刷新页面'}`;
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGomoku);
} else {
    initializeGomoku();
}
