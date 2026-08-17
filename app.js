/* ============================================================
 * 计划表 — 渲染进程逻辑
 * 长期计划:任务点(勾选+内容+起止日期)、备注
 * 每日计划:日历定位日期,当天计划(勾选+内容+时间段)
 * ============================================================ */

'use strict';

/* ---------- 运行环境与存储抽象 ----------
 * Electron 版:数据经 IPC 写入本地 JSON 文件
 * PWA/网页版:数据存浏览器 localStorage(手机本地)
 */
const IS_ELECTRON = typeof window !== 'undefined' && !!window.api;

const storage = {
  async load() {
    if (IS_ELECTRON) return window.api.loadData();
    try {
      const raw = localStorage.getItem('plans-data');
      if (!raw) return { longTermPlans: [], shortTermPlans: [] };
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return { longTermPlans: [], shortTermPlans: [] };
      if (!Array.isArray(data.longTermPlans)) data.longTermPlans = [];
      if (!Array.isArray(data.shortTermPlans)) data.shortTermPlans = [];
      return data;
    } catch (err) {
      console.error('读取本地数据失败:', err);
      return { longTermPlans: [], shortTermPlans: [] };
    }
  },
  async save(data) {
    if (IS_ELECTRON) return window.api.saveData(data);
    try {
      localStorage.setItem('plans-data', JSON.stringify(data));
      return { ok: true };
    } catch (err) {
      console.error('保存本地数据失败:', err);
      return { ok: false, error: String(err) };
    }
  }
};

/* ---------- 工具 ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad2(n) { return String(n).padStart(2, '0'); }

/** 本地时区 Date -> 'YYYY-MM-DD' */
function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 今天 'YYYY-MM-DD' */
function todayKey() { return fmtDate(new Date()); }

/** 'YYYY-MM-DD' -> 本地时区 Date */
function parseDate(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

/** 日期字符串加减天数 */
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 时间段内的所有日期(含首尾) */
function dateRange(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 5000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

function weekdayOf(s) {
  return WEEKDAYS[(parseDate(s).getDay() + 6) % 7];
}

/** 月份内天数 */
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

/* ---------- 全局状态 ---------- */
let state = { longTermPlans: [], shortTermPlans: [] };

/* 每日计划:日历当前浏览的月份 */
let calState = { y: 0, m: 0 };

/* 每日计划:当前选中的日期 'YYYY-MM-DD' */
let selectedDate = todayKey();

/* ---------- 数据持久化 ---------- */
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await storage.save(state);
    showSaveState(res && res.ok);
  }, 300);
}

function showSaveState(ok) {
  const el = document.getElementById('saveState');
  if (!el) return;
  el.textContent = ok ? '✓ 已保存' : '✗ 保存失败';
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 1200);
}

/* ---------- 渲染:每日计划 ---------- */
function dailyPlanFor(dateKey) {
  return state.shortTermPlans.find(p => p.date === dateKey) || null;
}

function getOrCreateDailyPlan(dateKey) {
  let p = dailyPlanFor(dateKey);
  if (!p) {
    p = { id: uid(), date: dateKey, tasks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.shortTermPlans.push(p);
  }
  return p;
}

function renderShort() {
  renderDailyCal();
  renderDailyTasks();
}

function renderDailyCal() {
  if (!calState.y) {
    const d = parseDate(selectedDate);
    calState = { y: d.getFullYear(), m: d.getMonth() };
  }
  const { y, m } = calState;
  document.getElementById('dailyCalTitle').textContent = `${y} 年 ${m + 1} 月`;
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // 周一=0
  const dim = daysInMonth(y, m);
  const today = todayKey();
  const hasPlan = new Set(
    state.shortTermPlans.filter(p => p.tasks && p.tasks.length).map(p => p.date)
  );

  let cells = '';
  let count = 0;
  for (let i = 0; i < firstWeekday; i++) { cells += '<div class="cal-day"></div>'; count++; }
  for (let day = 1; day <= dim; day++) {
    const key = `${y}-${pad2(m + 1)}-${pad2(day)}`;
    const cls = ['cal-day'];
    if (key === today) cls.push('today');
    if (hasPlan.has(key)) cls.push('has-note');
    if (key === selectedDate) cls.push('selected');
    cells += `<div class="${cls.join(' ')}" data-date="${key}">${day}</div>`;
    count++;
  }
  while (count % 7 !== 0) { cells += '<div class="cal-day"></div>'; count++; }

  const weekdays = '<div class="cal-weekday">一</div><div class="cal-weekday">二</div><div class="cal-weekday">三</div>' +
    '<div class="cal-weekday">四</div><div class="cal-weekday">五</div><div class="cal-weekday">六</div><div class="cal-weekday">日</div>';
  document.getElementById('dailyCal').innerHTML = weekdays + cells;
}

function renderDailyTasks() {
  document.getElementById('dailyDateLabel').textContent =
    `${selectedDate} ${weekdayOf(selectedDate)}${selectedDate === todayKey() ? '(今天)' : ''}`;
  const plan = dailyPlanFor(selectedDate);
  const listEl = document.getElementById('dailyTasks');
  document.getElementById('dailyEmpty').classList.toggle('hidden', !!(plan && plan.tasks && plan.tasks.length));
  if (!plan || !plan.tasks || !plan.tasks.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = plan.tasks.map(t => `
    <div class="task-row${t.done ? ' done' : ''}" data-task-id="${t.id}">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''}>
      <input class="task-text" value="${escAttr(t.text)}" placeholder="计划内容">
      <input class="task-time" value="${escAttr(t.timeRange || '')}" placeholder="时间段,如 14:00-16:00">
      <button class="task-del" title="删除">✕</button>
    </div>`).join('');
}

function addDailyTask() {
  const plan = getOrCreateDailyPlan(selectedDate);
  plan.tasks.push({ id: uid(), text: '', done: false, timeRange: '' });
  plan.updatedAt = new Date().toISOString();
  scheduleSave();
  renderShort();
  const rows = document.querySelectorAll('#dailyTasks .task-row');
  const el = rows[rows.length - 1] && rows[rows.length - 1].querySelector('.task-text');
  if (el) el.focus();
}

/* ---------- 渲染:长期计划 ---------- */
function longSortKey(p) { return p.periodValue || ''; }

function renderLong() {
  const listEl = document.getElementById('longList');
  document.getElementById('longEmpty').classList.toggle('hidden', state.longTermPlans.length > 0);

  const sorted = [...state.longTermPlans].sort((a, b) =>
    longSortKey(b).localeCompare(longSortKey(a)));

  listEl.innerHTML = sorted.map(plan => longCardHTML(plan)).join('');
}

function longCardHTML(p) {
  const done = (p.tasks || []).filter(t => t.done).length;
  const total = (p.tasks || []).length;
  const pct = total ? Math.round(done / total * 100) : 0;

  const tasks = (p.tasks || []).map(t => `
    <div class="task-row${t.done ? ' done' : ''}" data-task-id="${t.id}">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''}>
      <input class="task-text" value="${escAttr(t.text)}" placeholder="任务内容">
      <input type="date" class="task-start" value="${escAttr(t.startDate || '')}" title="开始日期">
      <span class="task-range-sep">~</span>
      <input type="date" class="task-end" value="${escAttr(t.endDate || '')}" title="截止日期">
      <button class="task-del" title="删除任务点">✕</button>
    </div>`).join('');

  return `
  <article class="card long-card" data-plan-id="${p.id}">
    <div class="card-head">
      <input class="plan-title" value="${escAttr(p.title)}" placeholder="计划标题">
      <button class="btn btn-danger btn-delete" title="删除计划">删除</button>
    </div>
    <div class="field">
      <label>任务点 <span class="task-progress">完成 ${done}/${total}${total ? ' · ' + pct + '%' : ''}</span></label>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="task-list">${tasks}</div>
      <button class="btn btn-sm btn-add-task">+ 添加任务点</button>
    </div>
    <div class="field">
      <label>备注</label>
      <textarea class="plan-note" placeholder="补充说明…">${escText(p.note || '')}</textarea>
    </div>
  </article>`;
}


function updateTaskProgress(card, plan) {
  const done = (plan.tasks || []).filter(t => t.done).length;
  const total = (plan.tasks || []).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const label = card.querySelector('.task-progress');
  if (label) label.textContent = `完成 ${done}/${total}${total ? ' · ' + pct + '%' : ''}`;
  const fill = card.querySelector('.progress-fill');
  if (fill) fill.style.width = pct + '%';
}

/* ---------- 长期计划:数据操作 ---------- */
function updateLongPlan(planId, patch) {
  const p = state.longTermPlans.find(x => x.id === planId);
  if (!p) return;
  Object.assign(p, patch);
  p.updatedAt = new Date().toISOString();
  scheduleSave();
  return p;
}

/* ---------- 新建 ---------- */
function newLongPlan() {
  const now = todayKey();
  const plan = {
    id: uid(),
    title: '新的长期计划',
    tasks: [{ id: uid(), text: '第一个任务点', done: false, startDate: '', endDate: '' }],
    note: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.longTermPlans.push(plan);
  renderLong();
  scheduleSave();
  const el = document.querySelector(`.long-card[data-plan-id="${plan.id}"] .plan-title`);
  if (el) { el.focus(); el.select(); }
}

/* ---------- 转义 ---------- */
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ============================================================
 * 事件绑定
 * ============================================================ */

function bindEvents() {
  /* 顶部 Tab */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view-long').classList.toggle('active', tab.dataset.tab === 'long');
      document.getElementById('view-short').classList.toggle('active', tab.dataset.tab === 'short');
    });
  });

  /* 新建 */
  document.getElementById('btnNewLong').addEventListener('click', newLongPlan);
  document.getElementById('btnAddDailyTask').addEventListener('click', addDailyTask);

  /* 导出 / 导入 */
  const doExport = async () => {
    if (IS_ELECTRON) {
      const res = await window.api.exportData(state);
      if (res && res.ok && !res.canceled) showSaveState(true);
    } else {
      webExport();
    }
  };
  const doImport = async () => {
    let res;
    if (IS_ELECTRON) {
      res = await window.api.importData();
    } else {
      res = { ok: true, data: await webImport() };
    }
    if (res && res.ok && res.data) {
      state = res.data;
      renderLong();
      renderShort();
      scheduleSave();
    }
  };
  document.getElementById('btnExport').addEventListener('click', doExport);
  document.getElementById('btnImport').addEventListener('click', doImport);
  if (IS_ELECTRON) {
    window.api.onMenuExport(doExport);
    window.api.onMenuImport(doImport);
  }

  /* ---------- 长期计划卡片事件 ---------- */
  document.getElementById('longList').addEventListener('input', (e) => {
    const card = e.target.closest('.long-card');
    if (!card) return;
    const id = card.dataset.planId;
    if (e.target.classList.contains('plan-title')) {
      updateLongPlan(id, { title: e.target.value });
    } else if (e.target.classList.contains('plan-note')) {
      updateLongPlan(id, { note: e.target.value });
    } else if (e.target.classList.contains('task-text')) {
      const row = e.target.closest('.task-row');
      const plan = state.longTermPlans.find(p => p.id === id);
      const task = plan && plan.tasks.find(t => t.id === row.dataset.taskId);
      if (task) { task.text = e.target.value; scheduleSave(); }
    }
  });

  document.getElementById('longList').addEventListener('change', (e) => {
    const card = e.target.closest('.long-card');
    if (!card) return;
    const id = card.dataset.planId;
    const plan = state.longTermPlans.find(p => p.id === id);
    if (!plan) return;

    if (e.target.classList.contains('task-check')) {
      const row = e.target.closest('.task-row');
      const task = plan.tasks.find(t => t.id === row.dataset.taskId);
      if (task) {
        task.done = e.target.checked;
        scheduleSave();
        row.classList.toggle('done', task.done);
        updateTaskProgress(card, plan);
      }
    } else if (e.target.classList.contains('task-start') || e.target.classList.contains('task-end')) {
      const row = e.target.closest('.task-row');
      const task = plan.tasks.find(t => t.id === row.dataset.taskId);
      if (task) {
        const key = e.target.classList.contains('task-start') ? 'startDate' : 'endDate';
        task[key] = e.target.value || '';
        scheduleSave();
      }
    }
  });

  document.getElementById('longList').addEventListener('click', (e) => {
    const card = e.target.closest('.long-card');
    if (!card) return;
    const id = card.dataset.planId;

    if (e.target.classList.contains('btn-add-task')) {
      const plan = state.longTermPlans.find(p => p.id === id);
      if (!plan) return;
      plan.tasks.push({ id: uid(), text: '新任务点', done: false });
      scheduleSave();
      renderLong();
      const newCard = document.querySelector(`.long-card[data-plan-id="${id}"]`);
      const rows = newCard && newCard.querySelectorAll('.task-row');
      const el = rows && rows[rows.length - 1] && rows[rows.length - 1].querySelector('.task-text');
      if (el) { el.focus(); el.select(); }
    } else if (e.target.classList.contains('task-del')) {
      const row = e.target.closest('.task-row');
      const plan = state.longTermPlans.find(p => p.id === id);
      if (!plan) return;
      plan.tasks = plan.tasks.filter(t => t.id !== row.dataset.taskId);
      scheduleSave();
      renderLong();
    } else if (e.target.classList.contains('btn-delete')) {
      if (confirm('确定删除这个长期计划吗?删除后不可恢复。')) {
        state.longTermPlans = state.longTermPlans.filter(p => p.id !== id);
        scheduleSave();
        renderLong();
      }
    }
  });

  /* ---------- 每日计划事件 ---------- */
  document.querySelector('.calendar-card').addEventListener('click', (e) => {
    if (e.target.classList.contains('cal-nav-btn')) {
      let m = calState.m + Number(e.target.dataset.nav);
      let y = calState.y;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      calState = { y, m };
      renderDailyCal();
    } else if (e.target.classList.contains('cal-day') && e.target.dataset.date) {
      selectedDate = e.target.dataset.date;
      renderDailyCal();
      renderDailyTasks();
    }
  });

  const dailyTasksEl = document.getElementById('dailyTasks');
  dailyTasksEl.addEventListener('input', (e) => {
    const row = e.target.closest('.task-row');
    if (!row) return;
    const plan = dailyPlanFor(selectedDate);
    if (!plan) return;
    const task = plan.tasks.find(t => t.id === row.dataset.taskId);
    if (!task) return;
    if (e.target.classList.contains('task-text')) task.text = e.target.value;
    else if (e.target.classList.contains('task-time')) task.timeRange = e.target.value;
    scheduleSave();
  });

  dailyTasksEl.addEventListener('change', (e) => {
    const row = e.target.closest('.task-row');
    if (!row) return;
    const plan = dailyPlanFor(selectedDate);
    if (!plan) return;
    const task = plan.tasks.find(t => t.id === row.dataset.taskId);
    if (!task) return;
    if (e.target.classList.contains('task-check')) {
      task.done = e.target.checked;
      row.classList.toggle('done', task.done);
      scheduleSave();
    }
  });

  dailyTasksEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('task-del')) {
      const row = e.target.closest('.task-row');
      const plan = dailyPlanFor(selectedDate);
      if (!plan) return;
      plan.tasks = plan.tasks.filter(t => t.id !== row.dataset.taskId);
      plan.updatedAt = new Date().toISOString();
      scheduleSave();
      renderDailyTasks();
    }
  });
}

/* ---------- 浏览器版导出 / 导入 ---------- */
function webExport() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '计划表备份-' + todayKey() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function webImport() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || typeof data !== 'object') throw new Error('格式无效');
          if (!Array.isArray(data.longTermPlans)) data.longTermPlans = [];
          if (!Array.isArray(data.shortTermPlans)) data.shortTermPlans = [];
          resolve(data);
        } catch (err) {
          alert('备份文件格式无效,无法导入。');
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

/* ---------- 启动 ---------- */
async function init() {
  try {
    state = await storage.load();
  } catch (err) {
    console.error('init: 加载数据失败', err);
  }
  renderLong();
  renderShort();
  bindEvents();
  // 网页版注册 Service Worker(离线可用、可安装到主屏);Electron(file://)下自动失败忽略
  if (!IS_ELECTRON && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
