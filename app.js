const STORAGE_KEY = 'heart_observer_mvp_v1';

const DEFAULT_PLAYERS = [
  { id: 'm1', gender: 'male', name: '男A' },
  { id: 'm2', gender: 'male', name: '男B' },
  { id: 'm3', gender: 'male', name: '男C' },
  { id: 'm4', gender: 'male', name: '男D' },
  { id: 'f1', gender: 'female', name: '女A' },
  { id: 'f2', gender: 'female', name: '女B' },
  { id: 'f3', gender: 'female', name: '女C' },
  { id: 'f4', gender: 'female', name: '女D' }
];

let db = loadDB();
let ui = {
  view: db.activeGameId ? 'home' : 'welcome',
  roundId: null,
  fillGender: 'male',
  quickMode: false,
  trendPlayerId: null,
  trendTab: 'people',
  rankFilter: 'all',
  mapRank: 'first'
};

function loadDB() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && Array.isArray(raw.games)) return raw;
  } catch (error) { console.warn('Stored data could not be read.', error); }
  return { version: 1, games: [], activeGameId: null };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function activeGame() {
  return db.games.find(game => game.id === db.activeGameId) || null;
}

function currentRound(game = activeGame()) {
  if (!game || !game.rounds.length) return null;
  return game.rounds.find(round => round.id === ui.roundId) || game.rounds[game.rounds.length - 1];
}

function player(game, id) {
  return game?.players.find(item => item.id === id) || null;
}

function pname(game, id, fallback = '尚未選擇') {
  return player(game, id)?.name || fallback;
}

function blankVotes(players) {
  return Object.fromEntries(players.map(item => [item.id, { first: null, second: null }]));
}

function newRound(game, copyFrom = null) {
  const number = game.rounds.length ? Math.max(...game.rounds.map(r => r.number)) + 1 : 1;
  const votes = copyFrom
    ? JSON.parse(JSON.stringify(copyFrom.votes))
    : blankVotes(game.players);
  return {
    id: `round_${String(number).padStart(3, '0')}_${Date.now().toString(36)}`,
    number,
    votes,
    saved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    analysis: { mutualPairs: [], oneWay: [], popularity: [], changes: [] }
  };
}

function analyzeRound(game, round) {
  const popularity = game.players.map(target => {
    let score = 0;
    game.players.forEach(voter => {
      const vote = round.votes[voter.id] || {};
      if (vote.first === target.id) score += 3;
      if (vote.second === target.id) score += 1;
    });
    return { playerId: target.id, score };
  }).sort((a,b) => b.score - a.score || pname(game, a.playerId).localeCompare(pname(game, b.playerId)));

  const mutualPairs = [];
  const oneWay = [];
  game.players.forEach(source => {
    ['first', 'second'].forEach(rank => {
      const targetId = round.votes[source.id]?.[rank];
      if (!targetId) return;
      const targetVote = round.votes[targetId] || {};
      const returnRank = targetVote.first === source.id ? 'first' : targetVote.second === source.id ? 'second' : null;
      if (!returnRank) oneWay.push({ from: source.id, to: targetId, rank });
      if (source.gender === 'male' && returnRank) {
        const points = (rank === 'first' ? 3 : 1) + (returnRank === 'first' ? 3 : 1);
        mutualPairs.push({ a: source.id, b: targetId, aRank: rank, bRank: returnRank, points });
      }
    });
  });
  mutualPairs.sort((a,b) => b.points - a.points);

  const previous = game.rounds
    .filter(r => r.number < round.number)
    .sort((a,b) => b.number - a.number)[0];
  const changes = [];
  if (previous) {
    game.players.forEach(person => {
      const before = previous.votes[person.id] || {};
      const now = round.votes[person.id] || {};
      if (before.first && now.first && before.first !== now.first) {
        const type = before.second === now.first ? '升溫' : '心動轉移';
        changes.push({ playerId: person.id, from: before.first, to: now.first, type });
      } else if (now.first && before.first === now.first) {
        changes.push({ playerId: person.id, from: now.first, to: now.first, type: '連續心動' });
      }
    });
  }
  return { mutualPairs, oneWay, popularity, changes, calculatedAt: new Date().toISOString() };
}

function refreshAllAnalysis(game) {
  game.rounds.forEach(round => { round.analysis = analyzeRound(game, round); });
}

function completedRounds(game) {
  return game.rounds.filter(round => round.saved);
}

function cumulativePopularity(game) {
  const scores = Object.fromEntries(game.players.map(p => [p.id, 0]));
  completedRounds(game).forEach(round => {
    const analysis = analyzeRound(game, round);
    analysis.popularity.forEach(item => { scores[item.playerId] += item.score; });
  });
  return Object.entries(scores).map(([playerId, score]) => ({ playerId, score }))
    .sort((a,b) => b.score - a.score || pname(game, a.playerId).localeCompare(pname(game, b.playerId)));
}

function showToast(message) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(message)}</div>`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { root.innerHTML = ''; }, 2200);
}

function closeSheet() {
  document.getElementById('sheet-root').innerHTML = '';
}

function showSheet(content) {
  document.getElementById('sheet-root').innerHTML = `<div class="sheet-backdrop" onclick="closeSheet()"></div><section class="sheet" role="dialog" aria-modal="true">${content}</section>`;
}

window.closeSheet = closeSheet;

function go(view) {
  ui.view = view;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  render();
}

const actions = {
  createGame() {
    const game = {
      id: uid('game'), name: '我的心動觀察',
      players: DEFAULT_PLAYERS.map(p => ({...p})), rounds: [],
      settings: { scoring: { first: 3, second: 1 } },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    db.games.push(game); db.activeGameId = game.id; persist();
    ui.view = 'setup'; render();
  },
  updateSetupName(id, value) {
    const p = player(activeGame(), id); if (p) p.name = value.slice(0, 18);
  },
  startGame() {
    const game = activeGame();
    if (game.players.some(p => !p.name.trim())) return showToast('每位嘉賓都需要名字');
    game.players.forEach(p => { p.name = p.name.trim(); });
    if (!game.rounds.length) game.rounds.push(newRound(game));
    ui.roundId = game.rounds[0].id; ui.view = 'fill'; persist(); render();
    showToast('遊戲建立完成');
  },
  go,
  prevRound(delta) {
    const game = activeGame(); const round = currentRound(game);
    const ordered = [...game.rounds].sort((a,b) => a.number-b.number);
    const index = ordered.findIndex(r => r.id === round.id);
    const next = ordered[index + delta]; if (next) { ui.roundId = next.id; render(); }
  },
  setFillGender(gender) { ui.fillGender = gender; ui.quickMode = false; render(); },
  toggleQuick() { ui.quickMode = !ui.quickMode; render(); },
  openVote(playerId, rank) { openVoteSheet(playerId, rank); },
  saveRound() {
    const game = activeGame(); const round = currentRound(game);
    round.saved = true; round.updatedAt = new Date().toISOString();
    round.analysis = analyzeRound(game, round); game.updatedAt = round.updatedAt;
    persist(); render(); showToast(`Round ${round.number} 已儲存 ✓`);
  },
  openRounds() { openRoundSheet(); },
  openAddRound() { openAddRoundSheet(); },
  addRound(copy) {
    const game = activeGame(); const source = copy ? currentRound(game) : null;
    const round = newRound(game, source); game.rounds.push(round); ui.roundId = round.id;
    persist(); closeSheet(); ui.view = 'fill'; render();
    showToast(`Round ${round.number} 已建立`);
  },
  selectRound(id, view = null) { ui.roundId = id; closeSheet(); if (view) ui.view = view; render(); },
  deleteRound(id) { confirmDeleteRound(id); },
  setTrendPlayer(id) { ui.trendPlayerId = id; ui.trendTab = 'people'; render(); },
  setTrendTab(tab) { ui.trendTab = tab; render(); },
  setRankFilter(filter) { ui.rankFilter = filter; render(); },
  setMapRank(rank) { ui.mapRank = rank; render(); },
  editNames() { ui.view = 'setup'; render(); },
  saveNames() {
    const game = activeGame();
    if (game.players.some(p => !p.name.trim())) return showToast('每位嘉賓都需要名字');
    refreshAllAnalysis(game); persist(); ui.view = 'settings'; render(); showToast('嘉賓名稱已更新');
  },
  resetAll() { confirmReset(); }
};

window.actions = actions;

function openVoteSheet(voterId, rank) {
  const game = activeGame(); const round = currentRound(game); const voter = player(game, voterId);
  const vote = round.votes[voterId] || (round.votes[voterId] = { first:null, second:null });
  const otherRank = rank === 'first' ? 'second' : 'first';
  const choices = game.players.filter(p => p.gender !== voter.gender && p.id !== vote[otherRank]);
  const label = rank === 'first' ? '第一心動' : '第二心動';
  const options = choices.map(p => `<button class="option ${vote[rank] === p.id ? 'selected' : ''}" onclick="selectVote('${voterId}','${rank}','${p.id}')"><span>${esc(p.name)}</span><span class="radio"></span></button>`).join('');
  showSheet(`<div class="sheet-handle"></div><div class="sheet-title"><div><p class="kicker">${esc(voter.name)}</p><h2>選擇${label}</h2></div><button class="icon-btn" onclick="closeSheet()" aria-label="關閉">×</button></div><div class="option-list">${options}<button class="option" onclick="selectVote('${voterId}','${rank}','')"><span class="muted">清除選擇</span><span>—</span></button></div>`);
}

window.selectVote = function(voterId, rank, targetId) {
  const game = activeGame(); const round = currentRound(game);
  if (!round.votes[voterId]) round.votes[voterId] = { first:null, second:null };
  round.votes[voterId][rank] = targetId || null;
  round.saved = false; round.updatedAt = new Date().toISOString();
  round.analysis = analyzeRound(game, round); persist(); closeSheet(); render();
};

function openRoundSheet() {
  const game = activeGame(); const round = currentRound(game);
  const rows = [...game.rounds].sort((a,b) => b.number-a.number).map(r => `<button class="option ${r.id === round.id ? 'selected' : ''}" onclick="actions.selectRound('${r.id}')"><span>Round ${r.number} <small class="muted">${r.saved ? '已儲存' : '編輯中'}</small></span><span class="radio"></span></button>`).join('');
  showSheet(`<div class="sheet-handle"></div><div class="sheet-title"><h2>選擇輪次</h2><button class="icon-btn" onclick="closeSheet()">×</button></div><div class="option-list">${rows}</div><div class="sheet-divider"></div><button class="btn btn-primary btn-block" onclick="actions.openAddRound()">＋ 新增一輪</button>`);
}

function openAddRoundSheet() {
  const round = currentRound();
  showSheet(`<div class="sheet-handle"></div><div class="sheet-title"><div><p class="kicker">NEW ROUND</p><h2>建立下一輪</h2></div><button class="icon-btn" onclick="closeSheet()">×</button></div><p class="muted">新輪次會建立獨立資料，不會覆蓋先前紀錄。</p><div class="option-list"><button class="option" onclick="actions.addRound(false)"><span><b>空白建立</b><br><small class="muted">從未選擇的狀態開始</small></span><span>＋</span></button><button class="option" onclick="actions.addRound(true)"><span><b>複製 Round ${round.number}</b><br><small class="muted">複製後仍可獨立修改</small></span><span>⧉</span></button></div>`);
}

function confirmDeleteRound(id) {
  const game = activeGame(); const round = game.rounds.find(r => r.id === id);
  showSheet(`<div class="sheet-handle"></div><div class="sheet-title"><h2>刪除 Round ${round.number}？</h2></div><p class="muted">這會永久刪除本輪心動選擇與分析，其他輪次不受影響。</p><div class="option-list"><button class="btn btn-danger btn-block" onclick="deleteRoundNow('${id}')">確認刪除</button><button class="btn btn-ghost btn-block" onclick="closeSheet()">保留本輪</button></div>`);
}

window.deleteRoundNow = function(id) {
  const game = activeGame();
  game.rounds = game.rounds.filter(r => r.id !== id);
  if (!game.rounds.length) game.rounds.push(newRound(game));
  ui.roundId = game.rounds[game.rounds.length - 1].id;
  refreshAllAnalysis(game); persist(); closeSheet(); render(); showToast('輪次已刪除');
};

function confirmReset() {
  showSheet(`<div class="sheet-handle"></div><div class="sheet-title"><h2>清除所有資料？</h2></div><p class="muted">所有遊戲、嘉賓與輪次都會從這台裝置移除，無法復原。</p><button class="btn btn-danger btn-block" onclick="resetNow()">確認全部清除</button><button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="closeSheet()">取消</button>`);
}

window.resetNow = function() {
  localStorage.removeItem(STORAGE_KEY); db = { version:1, games:[], activeGameId:null };
  ui.view = 'welcome'; ui.roundId = null; closeSheet(); render();
};

function topbar(game) {
  const round = currentRound(game);
  return `<header class="topbar"><div class="brand"><span class="brand-mark">♥</span><span>觀察員專用表格</span></div><button class="round-pill" onclick="actions.openRounds()"><span>R${round.number}</span><span class="muted">⌄</span></button></header>`;
}

function bottomNav() {
  const items = [
    ['home','⌂','首頁'], ['fill','✎','填寫'], ['relations','♥','關係'], ['trends','↗','趨勢'], ['settings','⚙','設定']
  ];
  return `<nav class="bottom-nav" aria-label="主要導覽">${items.map(([view, icon, label]) => `<button class="nav-btn ${ui.view === view ? 'active':''}" onclick="actions.go('${view}')"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('')}</nav>`;
}

function appFrame(content, extra = '') {
  const game = activeGame();
  return `<main class="app-shell with-nav">${topbar(game)}<section class="page ${extra}">${content}</section>${bottomNav()}</main>`;
}

function render() {
  const root = document.getElementById('app');
  const game = activeGame();
  if (!game || ui.view === 'welcome') { root.innerHTML = renderWelcome(); return; }
  if (ui.view === 'setup') { root.innerHTML = renderSetup(game); return; }
  if (!ui.roundId || !game.rounds.some(r => r.id === ui.roundId)) ui.roundId = game.rounds[game.rounds.length - 1]?.id;
  const pages = { home: renderDashboard, fill: renderFill, relations: renderRelations, trends: renderTrends, settings: renderSettings };
  root.innerHTML = (pages[ui.view] || renderDashboard)(game);
  if (ui.view === 'relations') requestAnimationFrame(drawSignalMap);
}

function renderWelcome() {
  return `<main class="app-shell welcome"><div class="welcome-brand"><span class="brand-mark">♥</span>觀察員專用表格</div><section class="welcome-stage"><div class="eyebrow">LOVE SIGNAL NOTEBOOK</div><h1>每一眼心動，<br>都有跡可循。</h1><p class="welcome-copy">為戀愛綜藝與線上劇本殺設計的隨身觀察工具。記下每輪選擇，一眼看懂誰喜歡誰。</p><div class="constellation" aria-hidden="true"><span class="person-dot">A</span><span class="person-dot">B</span><span class="person-dot">C</span><span class="person-dot">D</span></div></section><button class="btn btn-primary btn-block" onclick="actions.createGame()">＋ 建立新遊戲</button><p class="tiny muted" style="text-align:center;margin:14px 0 0">資料只保存在這台裝置</p></main>`;
}

function renderSetup(game) {
  const fields = gender => game.players.filter(p => p.gender === gender).map((p, i) => `<label class="name-field"><span>${gender === 'male' ? '男生' : '女生'} ${i+1}</span><input value="${esc(p.name)}" maxlength="18" oninput="actions.updateSetupName('${p.id}', this.value)" aria-label="${gender === 'male' ? '男生' : '女生'} ${i+1} 名稱"></label>`).join('');
  const isNew = !game.rounds.length;
  return `<main class="app-shell"><section class="page"><div class="setup-head"><p class="kicker">CAST SETUP</p><h1>嘉賓設定</h1><p class="muted">保留預設名稱也可以，之後仍能在設定中修改。</p></div><div class="gender-block"><div class="gender-title"><span class="gender-swatch"></span>男生</div><div class="field-list">${fields('male')}</div></div><div class="gender-block"><div class="gender-title"><span class="gender-swatch female"></span>女生</div><div class="field-list">${fields('female')}</div></div><div class="setup-submit"><button class="btn btn-primary btn-block" onclick="${isNew ? 'actions.startGame()' : 'actions.saveNames()'}">${isNew ? '開始遊戲' : '儲存嘉賓名稱'}</button></div></section></main>`;
}

function renderDashboard(game) {
  const round = currentRound(game); const a = analyzeRound(game, round); round.analysis = a;
  const ordered = [...game.rounds].sort((x,y) => x.number-y.number); const index = ordered.findIndex(r => r.id === round.id);
  const strongest = a.mutualPairs[0];
  const top = a.popularity.filter(x => x.score > 0).slice(0,4);
  const mutualHtml = a.mutualPairs.length ? a.mutualPairs.slice(0,4).map(pair => `<div class="list-row"><div class="arrow-line"><b>${esc(pname(game,pair.a))}</b><span class="heart">↔</span><b>${esc(pname(game,pair.b))}</b></div><span class="tag">${pair.aRank === 'first' && pair.bRank === 'first' ? '雙方第一' : '互相心動'}</span></div>`).join('') : `<div class="empty-mini">尚未形成互選，繼續觀察下一個心動訊號。</div>`;
  const oneWay = a.oneWay.filter(v => v.rank === 'first').slice(0,4);
  const changes = a.changes.slice(0,4);
  const content = `<div class="hero"><p class="kicker">CURRENT ROUND</p><div class="hero-row"><div><h1 class="round-title">Round ${round.number}</h1><span class="tag">${round.saved ? '已儲存' : '編輯中'}</span></div><div class="round-actions"><button class="icon-btn" ${index===0?'disabled':''} onclick="actions.prevRound(-1)" aria-label="上一輪">‹</button><button class="icon-btn" ${index===ordered.length-1?'disabled':''} onclick="actions.prevRound(1)" aria-label="下一輪">›</button></div></div></div>
  <section class="card feature-card"><div class="card-label"><span>✦</span>本輪最強配對</div>${strongest ? `<div class="pair-big"><span>${esc(pname(game,strongest.a))}</span><span class="heart">♥</span><span>${esc(pname(game,strongest.b))}</span></div><p style="margin:9px 0 0;opacity:.8">${strongest.aRank==='first'&&strongest.bRank==='first'?'雙方第一心動':'互相進入心動名單'}</p>` : `<div class="pair-big">等待心動訊號</div><p style="margin:9px 0 0;opacity:.8">填寫雙方選擇後自動分析</p>`}</section>
  <div class="summary-grid"><section class="card"><div class="card-label"><span class="dot"></span>本輪互選</div>${mutualHtml}</section><section class="card"><div class="card-label"><span class="dot"></span>第一單戀</div>${oneWay.length ? oneWay.map(v => `<div class="arrow-line" style="margin-bottom:9px"><span>${esc(pname(game,v.from))}</span><span class="arrow">→</span><b>${esc(pname(game,v.to))}</b></div>`).join('') : `<div class="empty-mini">目前沒有第一心動的單向箭頭。</div>`}</section></div>
  <div class="section-head"><h2>本輪人氣</h2><button class="text-btn" onclick="actions.go('relations')">查看關係</button></div><section class="card"><div class="list">${top.length ? top.map((item,i) => `<div class="list-row"><div class="rank"><span class="rank-no">${String(i+1).padStart(2,'0')}</span><b>${esc(pname(game,item.playerId))}</b></div><span class="score">${item.score} 分</span></div>`).join('') : `<div class="empty-mini">第一心動 +3 分、第二心動 +1 分。填寫後會即時排行。</div>`}</div></section>
  <div class="section-head"><h2>本輪變化</h2></div><section class="card">${changes.length ? changes.map(c => `<div class="list-row"><div><b>${esc(pname(game,c.playerId))}</b><div class="arrow-line tiny"><span>${esc(pname(game,c.from))}</span><span class="arrow">→</span><span>${esc(pname(game,c.to))}</span></div></div><span class="tag">${c.type}</span></div>`).join('') : `<div class="empty-mini">${round.number === 1 ? '首輪是所有故事的起點。' : '尚無足夠選擇可比較。'}</div>`}</section>`;
  return appFrame(content);
}

function voteCard(game, round, p) {
  const vote = round.votes[p.id] || {first:null,second:null};
  const choice = (rank, label) => `<div><span class="choice-label">${label}</span><button class="select-btn ${vote[rank]?'filled':''}" onclick="actions.openVote('${p.id}','${rank}')"><span>${vote[rank] ? esc(pname(game,vote[rank])) : '點選嘉賓'}</span><span>⌄</span></button></div>`;
  return `<article class="card vote-card"><div class="player-head"><span class="player-name">${esc(p.name)}</span><span class="tag">${p.gender==='male'?'男生':'女生'}</span></div><div class="choice-grid">${choice('first','第一心動 · 3分')}${choice('second','第二心動 · 1分')}</div></article>`;
}

function renderFill(game) {
  const round = currentRound(game);
  const visible = ui.quickMode ? game.players : game.players.filter(p => p.gender === ui.fillGender);
  const content = `<div class="subhead"><p class="kicker">RECORD SIGNALS</p><div class="subhead-row"><div><h1>Round ${round.number}</h1><p class="muted" style="margin:0">只可選擇異性，第一與第二不可重複。</p></div></div></div>
  <div class="segmented"><button class="seg-btn ${ui.fillGender==='male'&&!ui.quickMode?'active':''}" onclick="actions.setFillGender('male')">男生</button><button class="seg-btn ${ui.fillGender==='female'&&!ui.quickMode?'active':''}" onclick="actions.setFillGender('female')">女生</button></div>
  <div class="fill-controls"><span class="tiny muted">${ui.quickMode?'一次顯示全部 8 位':'每組 4 位，適合單手逐一填寫'}</span><button class="mode-toggle ${ui.quickMode?'active':''}" onclick="actions.toggleQuick()">⚡ 快速填寫</button></div>
  <div class="${ui.quickMode?'quick-all':''}">${visible.map(p => voteCard(game,round,p)).join('')}</div>
  <div class="save-dock"><button class="btn btn-primary btn-block" onclick="actions.saveRound()">▣ 儲存 Round ${round.number}</button></div>`;
  return appFrame(content, 'has-save');
}

function starString(points) {
  const count = points >= 6 ? 5 : points >= 4 ? 4 : 3;
  return '★'.repeat(count) + '☆'.repeat(5-count);
}

function renderRelations(game) {
  const round = currentRound(game); const a = analyzeRound(game, round);
  const mutualCards = a.mutualPairs.map((pair,i) => `<article class="card ${i===0?'feature-card':''}"><div class="card-label"><span>${i===0?'✦':'♥'}</span>${i===0?'最強配對':'互選配對'}</div><div class="relation-visual"><div class="person-badge">${esc(pname(game,pair.a))}</div><div class="relation-arrow">♥<br>↕</div><div class="person-badge">${esc(pname(game,pair.b))}</div></div><div class="list-row"><span>${esc(pname(game,pair.a))}：${pair.aRank==='first'?'第一':'第二'}心動</span><span class="stars">${starString(pair.points)}</span></div><div class="list-row"><span>${esc(pname(game,pair.b))}：${pair.bRank==='first'?'第一':'第二'}心動</span><span class="tag">${pair.points===6?'雙方第一':'互相心動'}</span></div></article>`).join('');
  const oneWay = a.oneWay.map(v => `<div class="list-row"><div class="arrow-line"><b>${esc(pname(game,v.from))}</b><span class="heart">♥</span><span class="arrow">→</span><b>${esc(pname(game,v.to))}</b></div><span class="tag">${v.rank==='first'?'第一':'第二'}</span></div>`).join('');
  const content = `<div class="subhead"><p class="kicker">RELATION MAP</p><h1>Round ${round.number} 關係</h1><p class="muted">用箭頭方向比對雙方選擇，再以配對卡查看細節。</p></div>${renderSignalMap(game, round)}<div class="section-head"><h2>配對分析</h2><span class="tiny muted">${a.mutualPairs.length} 組互選</span></div>${mutualCards || `<section class="card empty-state"><div class="empty-symbol">♥</div><h3>尚無互選配對</h3><p>完成更多心動選擇後，配對會出現在這裡。</p></section>`}<div class="section-head"><h2>單向心動</h2><span class="tiny muted">${a.oneWay.length} 條箭頭</span></div><section class="card">${oneWay || `<div class="empty-mini">目前沒有單向心動。</div>`}</section><div class="section-head"><h2>本輪人氣</h2></div>${renderPopularityCard(game, a.popularity, false)}`;
  return appFrame(content);
}

function renderSignalMap(game, round) {
  const people = gender => game.players.filter(p => p.gender === gender)
    .map(p => `<button class="signal-person ${gender}" data-signal-player="${p.id}" onclick="actions.setTrendPlayer('${p.id}');actions.go('trends')"><span>${esc(p.name)}</span></button>`).join('');
  const ranks = ui.mapRank === 'all' ? ['first', 'second'] : ['first'];
  const hasLines = game.players.some(p => ranks.some(rank => round.votes[p.id]?.[rank]));
  return `<section class="card signal-card"><div class="signal-head"><div><div class="card-label"><span class="dot"></span>心動線圖</div><p class="tiny muted">點擊名字可查看人物歷史</p></div><div class="signal-legend"><span><i class="legend-line male"></i>男生</span><span><i class="legend-line female"></i>女生</span></div></div><div class="segmented signal-filter"><button class="seg-btn ${ui.mapRank==='first'?'active':''}" onclick="actions.setMapRank('first')">只看第一心動</button><button class="seg-btn ${ui.mapRank==='all'?'active':''}" onclick="actions.setMapRank('all')">第一＋第二</button></div><div class="signal-map" data-signal-map data-ranks="${ranks.join(',')}"><svg class="signal-svg" aria-hidden="true"></svg><div class="signal-column left"><span class="signal-side-label">男生</span>${people('male')}</div><div class="signal-column right"><span class="signal-side-label">女生</span>${people('female')}</div>${hasLines?'':`<div class="signal-empty">尚未填寫心動選擇</div>`}</div><div class="signal-note"><span><b>實線</b> 第一心動</span>${ui.mapRank==='all'?`<span><b>虛線</b> 第二心動</span>`:''}<span><b>箭頭</b> 喜歡方向</span></div></section>`;
}

function drawSignalMap() {
  const map = document.querySelector('[data-signal-map]');
  if (!map) return;
  const game = activeGame(); const round = currentRound(game);
  const svg = map.querySelector('.signal-svg');
  const bounds = map.getBoundingClientRect();
  const width = Math.round(bounds.width); const height = Math.round(bounds.height);
  if (!width || !height) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const ranks = map.dataset.ranks.split(',');
  const defs = `<defs><marker id="arrow-male" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="#4b8dbf"/></marker><marker id="arrow-female" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="#c65267"/></marker></defs>`;
  const paths = [];
  game.players.forEach(voter => {
    ranks.forEach(rank => {
      const targetId = round.votes[voter.id]?.[rank];
      if (!targetId) return;
      const source = map.querySelector(`[data-signal-player="${voter.id}"]`);
      const target = map.querySelector(`[data-signal-player="${targetId}"]`);
      if (!source || !target) return;
      const s = source.getBoundingClientRect(); const t = target.getBoundingClientRect();
      const isMale = voter.gender === 'male';
      const x1 = isMale ? s.right - bounds.left - 2 : s.left - bounds.left + 2;
      const x2 = isMale ? t.left - bounds.left + 2 : t.right - bounds.left - 2;
      const y1 = s.top - bounds.top + s.height / 2;
      const y2 = t.top - bounds.top + t.height / 2;
      const middle = (x1 + x2) / 2;
      const bend = isMale ? -7 : 7;
      const color = isMale ? '#4b8dbf' : '#c65267';
      const marker = isMale ? 'arrow-male' : 'arrow-female';
      const second = rank === 'second';
      paths.push(`<path d="M ${x1} ${y1} C ${middle} ${y1+bend}, ${middle} ${y2+bend}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${second?1.7:2.7}" stroke-linecap="round" ${second?'stroke-dasharray="5 5" opacity=".58"':'opacity=".9"'} marker-end="url(#${marker})"/>`);
    });
  });
  svg.innerHTML = defs + paths.join('');
}

window.addEventListener('resize', () => {
  if (ui.view === 'relations') requestAnimationFrame(drawSignalMap);
});

function renderPopularityCard(game, ranking, cumulative = false) {
  const top = ranking[0];
  return `<section class="card ranking-hero">${top ? `<div class="crown">TOP SIGNAL</div><div class="winner">${esc(pname(game,top.playerId))}</div><div class="big-score">${top.score} 分</div>` : ''}</section><section class="card"><div class="list">${ranking.map((item,i) => `<div class="list-row"><div class="rank"><span class="rank-no">${String(i+1).padStart(2,'0')}</span><b>${esc(pname(game,item.playerId))}</b></div><span class="score">${item.score} ${cumulative?'累積分':'分'}</span></div>`).join('')}</div></section>`;
}

function personStatus(game, personId) {
  const rounds = completedRounds(game).sort((a,b) => a.number-b.number);
  if (!rounds.length) return { text:'尚無已儲存紀錄', mutual:false };
  const latest = rounds[rounds.length-1]; const latestFirst = latest.votes[personId]?.first;
  if (!latestFirst) return { text:'本輪尚未選擇第一心動', mutual:false };
  let streak = 0;
  for (let i=rounds.length-1; i>=0; i--) {
    if (rounds[i].votes[personId]?.first === latestFirst) streak++; else break;
  }
  const targetVote = latest.votes[latestFirst] || {};
  const mutual = targetVote.first === personId || targetVote.second === personId;
  return { text: streak > 1 ? `連續 ${streak} 輪選擇 ${pname(game,latestFirst)}` : `最新選擇 ${pname(game,latestFirst)}`, mutual };
}

function timelineFlags(game, personId, rounds, index) {
  if (index === 0) return [];
  const now = rounds[index].votes[personId] || {}; const before = rounds[index-1].votes[personId] || {};
  const flags = [];
  if (now.first && now.first === before.first) flags.push('連續心動');
  if (now.first && before.first && now.first !== before.first) flags.push(before.second === now.first ? '升溫' : '心動轉移');
  if (now.second && before.first === now.second) flags.push('降溫');
  return flags;
}

function renderPersonTrend(game) {
  const id = ui.trendPlayerId && player(game,ui.trendPlayerId) ? ui.trendPlayerId : game.players[0].id;
  ui.trendPlayerId = id;
  const personData = player(game,id); const rounds = completedRounds(game).sort((a,b)=>a.number-b.number);
  const latest = rounds[rounds.length-1]; const vote = latest?.votes[id] || {};
  const status = personStatus(game,id);
  const chips = game.players.map(p => `<button class="person-chip ${p.id===id?'active':''}" onclick="actions.setTrendPlayer('${p.id}')">${esc(p.name)}</button>`).join('');
  const timeline = rounds.map((round,i) => { const v=round.votes[id]||{}; const flags=timelineFlags(game,id,rounds,i); return `<div class="timeline-item"><div class="timeline-round">ROUND ${round.number}</div><div class="timeline-choice"><span><span class="heart">♥</span> ${esc(pname(game,v.first))}</span><span><span class="muted">♡</span> ${esc(pname(game,v.second))}</span></div>${flags.length?`<div style="margin-top:7px">${flags.map(f=>`<span class="tag">${f}</span>`).join(' ')}</div>`:''}</div>`; }).join('');
  return `<div class="people-scroll">${chips}</div><section class="card feature-card"><div class="card-label">PERSON PROFILE</div><div class="pair-big">${esc(personData.name)}</div><div class="list-row"><span>目前第一心動</span><b>${esc(pname(game,vote.first))}</b></div><div class="list-row"><span>目前第二心動</span><b>${esc(pname(game,vote.second))}</b></div></section><section class="card" style="margin-top:12px"><div class="card-label"><span class="dot"></span>目前狀態</div><h3>${esc(status.text)}</h3><span class="tag">${status.mutual?'互相心動':'單向心動'}</span></section><div class="section-head"><h2>${esc(personData.name)} 的心動歷史</h2></div><section class="card">${timeline?`<div class="timeline">${timeline}</div>`:`<div class="empty-mini">儲存第一輪後，這裡會形成縱向時間線。</div>`}</section>`;
}

function renderAllRounds(game) {
  const rounds = [...game.rounds].sort((a,b)=>b.number-a.number);
  return `<div class="list">${rounds.map(round => { const a=analyzeRound(game,round); const strong=a.mutualPairs[0]; const popular=a.popularity[0]; const change=a.changes.find(c=>c.type==='心動轉移'||c.type==='升溫'); return `<article class="card round-card" onclick="actions.selectRound('${round.id}','home')"><div class="round-card-head"><h3>Round ${round.number}</h3><span class="tag">${round.saved?'已儲存':'編輯中'}</span></div>${strong?`<div class="arrow-line"><span class="heart">♥</span><b>${esc(pname(game,strong.a))} × ${esc(pname(game,strong.b))}</b></div>`:`<div class="muted">尚無互選配對</div>`}${popular&&popular.score?`<p class="tiny muted" style="margin:9px 0 0">熱門：${esc(pname(game,popular.playerId))} · ${popular.score} 分</p>`:''}${change?`<p class="tiny" style="margin:6px 0 0;color:var(--berry)">${esc(pname(game,change.playerId))} ${change.type}</p>`:''}</article>`; }).join('')}</div>`;
}

function renderCumulative(game) {
  let ranking = cumulativePopularity(game);
  if (ui.rankFilter !== 'all') ranking = ranking.filter(x => player(game,x.playerId).gender === ui.rankFilter);
  return `<div class="segmented three" style="margin-bottom:12px"><button class="seg-btn ${ui.rankFilter==='all'?'active':''}" onclick="actions.setRankFilter('all')">全部</button><button class="seg-btn ${ui.rankFilter==='male'?'active':''}" onclick="actions.setRankFilter('male')">男生</button><button class="seg-btn ${ui.rankFilter==='female'?'active':''}" onclick="actions.setRankFilter('female')">女生</button></div><p class="muted tiny">統計所有已儲存輪次 · 第一心動 +3、第二心動 +1</p>${renderPopularityCard(game,ranking,true)}`;
}

function renderTrends(game) {
  const tabs = `<div class="segmented three"><button class="seg-btn ${ui.trendTab==='people'?'active':''}" onclick="actions.setTrendTab('people')">人物</button><button class="seg-btn ${ui.trendTab==='rounds'?'active':''}" onclick="actions.setTrendTab('rounds')">全部輪次</button><button class="seg-btn ${ui.trendTab==='ranking'?'active':''}" onclick="actions.setTrendTab('ranking')">累積人氣</button></div>`;
  const body = ui.trendTab==='people' ? renderPersonTrend(game) : ui.trendTab==='rounds' ? renderAllRounds(game) : renderCumulative(game);
  return appFrame(`<div class="subhead"><p class="kicker">ACROSS ROUNDS</p><h1>跨輪趨勢</h1><p class="muted">從個人心動軌跡，到整季人氣變化。</p></div>${tabs}<div style="height:14px"></div>${body}`);
}

function renderSettings(game) {
  const rounds = [...game.rounds].sort((a,b)=>b.number-a.number);
  const manage = rounds.map(round => `<div class="manage-row"><div><b>Round ${round.number}</b><br><span class="tiny muted">${round.saved?'已儲存':'編輯中'} · ${round.id.split('_').slice(0,2).join('_')}</span></div><button class="btn btn-danger" style="min-height:42px;padding:8px 13px" onclick="actions.deleteRound('${round.id}')">刪除</button></div>`).join('');
  const content = `<div class="subhead"><p class="kicker">GAME SETTINGS</p><h1>設定</h1><p class="muted">管理嘉賓、輪次與裝置內資料。</p></div><section class="card"><div class="card-label"><span class="dot"></span>嘉賓設定</div><div class="list-row"><div><b>8 位嘉賓</b><br><span class="tiny muted">${game.players.map(p=>esc(p.name)).join('、')}</span></div></div><button class="btn btn-secondary btn-block" onclick="actions.editNames()">修改嘉賓名稱</button></section><div class="section-head"><h2>輪次管理</h2><button class="text-btn" onclick="actions.openAddRound()">＋ 新增</button></div><section class="card">${manage}</section><div class="section-head"><h2>資料保存</h2></div><section class="card"><div class="list-row"><div><b>本機自動保存</b><br><span class="tiny muted">每個遊戲、每輪資料皆獨立保存於 localStorage</span></div><span class="tag">已啟用</span></div><div class="list-row"><span>已建立輪次</span><b>${game.rounds.length}</b></div><div class="list-row"><span>已完成輪次</span><b>${completedRounds(game).length}</b></div></section><div class="section-head"><h2>危險區域</h2></div><section class="card danger-zone"><p class="muted">清除這台裝置上的所有遊戲與歷史紀錄。</p><button class="btn btn-danger btn-block" onclick="actions.resetAll()">清除全部資料</button></section>`;
  return appFrame(content);
}

render();
