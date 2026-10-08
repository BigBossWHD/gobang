const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, openings } = require('./ai-compare.cjs');

test('比较工具拒绝非法预算，固定版本与运行选项明确', () => {
    assert.throws(() => parseArgs(['--node-limit', '0']));
    assert.throws(() => parseArgs(['--rounds', 'NaN']));
    assert.throws(() => parseArgs(['--baseline']));
    assert.throws(() => parseArgs(['--unrecognized']));
    assert.equal(parseArgs([]).baseline, '8a4f590');
});

test('跨 Git 版本比较保持配对开局，步数上限不冒充和棋', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gobang-compare-'));
    try {
        const destination = path.join(directory, 'report.json');
        execFileSync(process.execPath, [path.join(__dirname, 'ai-compare.cjs'), '--baseline', '8a4f590',
            '--time-ms', '0', '--max-moves', '6', '--output', destination], { stdio: 'pipe' });
        const report = JSON.parse(fs.readFileSync(destination, 'utf8'));
        assert.equal(report.summary.games, openings.length * 2);
        assert.equal(report.summary.capped, openings.length * 2);
        assert.equal(report.summary.draws, 0);
        assert.match(report.engines.baseline, /^[a-f0-9]{40}$/);
        assert.match(report.candidateSourceSha256, /^[a-f0-9]{64}$/);
        for (let i = 0; i < report.matches.length; i += 2) {
            const [first, second] = report.matches.slice(i, i + 2);
            assert.equal(first.candidateColor, 'black');
            assert.equal(second.candidateColor, 'white');
            assert.equal(first.seed, second.seed);
            assert.deepEqual(first.moves.slice(0, openings[i / 2].moves.length), second.moves.slice(0, openings[i / 2].moves.length));
        }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('固定节点模式重复运行产生相同棋谱', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gobang-repeat-'));
    try {
        const reports = [];
        for (let run = 0; run < 2; run++) {
            const destination = path.join(directory, `${run}.json`);
            execFileSync(process.execPath, [path.join(__dirname, 'ai-compare.cjs'), '--baseline', '8a4f590',
                '--time-ms', '250', '--node-limit', '30', '--max-moves', '8', '--deterministic', '--output', destination], { stdio: 'pipe' });
            reports.push(JSON.parse(fs.readFileSync(destination, 'utf8')));
        }
        assert.deepEqual(reports[0].matches, reports[1].matches);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
