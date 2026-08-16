/* ============================================================
 * 计划表 — 渲染进程逻辑
 * 长期计划:按年/月,任务点勾选,备注
 * 短期计划:起止时间段,时间段内每一天可记录、始终可改
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

/* 每个短期计划当前浏览的日历月份 {planId: {y, m}} */
const calState = {};

/* 弹层当前编辑目标 */
let modalTarget = null; // { planId, dateKey }

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

/* ---------- 弹层 ---------- */
function openDayModal(planId, dateKey) {
  modalTarget = { planId, dateKey };
  const plan = state.shortTermPlans.find(p => p.id === planId);
  if (!plan) return;
  document.getElementById('dayModalDate').textContent =
    `${dateKey} ${weekdayOf(dateKey)}${dateKey === todayKey() ? '(今天)' : ''}`;
  const ta = document.getElementById('dayModalText');
  ta.value = (plan.dailyNotes && plan.dailyNotes[dateKey]) || '';
  document.getElementById('dayModal').classList.remove('hidden');
  setTimeout(() => ta.focus(), 30);
}

function closeDayModal() {
  document.getElementById('dayModal').classList.add('hidden');
  modalTarget = null;
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
  const monthHidden = p.periodType !== 'month' ? ' hidden' : '';

  const tasks = (p.tasks || []).map(t => `
    <div class="task-row${t.done ? ' done' : ''}" data-task-id="${t.id}">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''}>
      <input class="task-text" value="${escAttr(t.text)}">
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
    <div class="field">
      <label>时间</label>
      <div class="period-controls">
        <select class="period-type">
          <option value="year" ${p.periodType !== 'month' ? 'selected' : ''}>按年</option>
          <option value="month" ${p.periodType === 'month' ? 'selected' : ''}>按月</option>
        </select>
        <select class="period-year">${yearOptions(p.periodValue)}</select>
        <select class="period-month${monthHidden}">${monthOptions(p.periodValue)}</select>
      </div>
    </div>
  </article>`;
}

function yearOptions(current) {
  const y = current ? Number(current.slice(0, 4)) : new Date().getFullYear();
  let html = '';
  for (let i = 2015; i <= 2045; i++) {
    html += `<option value="${i}" ${i === y ? 'selected' : ''}>${i} 年</option>`;
  }
  return html;
}

function monthOptions(periodValue) {
  const m = periodValue ? Number(periodValue.split('-')[1]) : new Date().getMonth() + 1;
  let html = '';
  for (let i = 1; i <= 12; i++) {
    html += `<option value="${i}" ${i === m ? 'selected' : ''}>${i} 月</option>`;
  }
  return html;
}

/* ---------- 渲染:短期计划 ---------- */
function renderShort() {
  const listEl = document.getElementById('shortList');
  document.getElementById('shortEmpty').classList.toggle('hidden', state.shortTermPlans.length > 0);

  const sorted = [...state.shortTermPlans].sort((a, b) =>
    (b.startDate || '').localeCompare(a.startDate || ''));

  listEl.innerHTML = sorted.map(plan => shortCardHTML(plan)).join('');

  // 渲染每个卡片的日历/列表
  listEl.querySelectorAll('.short-card').forEach(el => {
    const plan = state.shortTermPlans.find(p => p.id === el.dataset.planId);
    if (plan) renderDailyArea(el, plan);
  });
}

function shortCardHTML(p) {
  const st = p.startDate || todayKey();
  const en = p.endDate || addDays(st, 6);
  const done = (p.tasks || []).filter(t => t.done).length;
  const total = (p.tasks || []).length;
  const pct = total ? Math.round(done / total * 100) : 0;

  const tasks = (p.tasks || []).map(t => `
    <div class="task-row${t.done ? ' done' : ''}" data-task-id="${t.id}">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''}>
      <input class="task-text" value="${escAttr(t.text)}">
      <button class="task-del" title="删除任务点">✕</button>
    </div>`).join('');

  return `
  <article class="card short-card" data-plan-id="${p.id}">
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
    <div class="field">
      <label>时间段</label>
      <div class="date-range">
        <input type="date" class="start-date" value="${st}">
        <span>~</span>
        <input type="date" class="end-date" value="${en}">
      </div>
    </div>
    <div class="field daily-area">
      <label>每日记录<span class="hint">(时间段内的每一天都可单独填写,过去与未来始终保留、随时修改)</span>
        <span class="view-toggle">
          <button class="vt-btn active" data-mode="calendar">日历</button>
          <button class="vt-btn" data-mode="list">列表</button>
        </span>
      </label>
      <div class="calendar-wrap"></div>
      <div class="day-list" hidden></div>
    </div>
  </article>`;
}

function renderDailyArea(cardEl, plan) {
  const start = plan.startDate, end = plan.endDate;
  const mode = plan.viewMode || 'calendar';
  const nav = cardEl.querySelector('.view-toggle');
  nav.querySelectorAll('.vt-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));

  const calWrap = cardEl.querySelector('.calendar-wrap');
  const dayList = cardEl.querySelector('.day-list');
  calWrap.hidden = mode !== 'calendar';
  dayList.hidden = mode !== 'list';

  if (mode === 'calendar') renderCalendar(cardEl, plan);
  else renderDayList(dayList, plan);
}

function renderCalendar(cardEl, plan) {
  const wrap = cardEl.querySelector('.calendar-wrap');
  const id = plan.id;
  if (!calState[id]) {
    const d = parseDate(plan.startDate || todayKey());
    calState[id] = { y: d.getFullYear(), m: d.getMonth() };
  }
  const { y, m } = calState[id];
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // 周一=0
  const dim = daysInMonth(y, m);
  const today = todayKey();
  const start = plan.startDate, end = plan.endDate;

  let cells = '';
  let cellCount = 0;
  for (let i = 0; i < firstWeekday; i++) { cells += '<div class="cal-day"></div>'; cellCount++; }

  for (let day = 1; day <= dim; day++) {
    const key = `${y}-${pad2(m + 1)}-${pad2(day)}`;
    const inRange = (!start || key >= start) && (!end || key <= end);
    const hasNote = plan.dailyNotes && plan.dailyNotes[key];
    const cls = ['cal-day'];
    if (inRange) cls.push('in-range');
    if (key === today) cls.push('today');
    if (hasNote) cls.push('has-note');
    cells += `<div class="${cls.join(' ')}" data-date="${key}">${day}</div>`;
    cellCount++;
  }
  while (cellCount % 7 !== 0) { cells += '<div class="cal-day"></div>'; cellCount++; }

  wrap.innerHTML = `
    <div class="calendar-nav">
      <button class="cal-nav-btn" data-nav="-1">‹ 上月</button>
      <span class="cal-title">${y} 年 ${m + 1} 月</span>
      <button class="cal-nav-btn" data-nav="1">下月 ›</button>
    </div>
    <div class="calendar">
      <div class="cal-weekday">一</div><div class="cal-weekday">二</div><div class="cal-weekday">三</div>
      <div class="cal-weekday">四</div><div class="cal-weekday">五</div><div class="cal-weekday">六</div>
      <div class="cal-weekday">日</div>
      ${cells}
    </div>`;
}

function renderDayList(listEl, plan) {
  const start = plan.startDate, end = plan.endDate;
  const today = todayKey();
  if (!start || !end) { listEl.innerHTML = '<div class="hint">请先选择起止日期</div>'; return; }
  const rows = dateRange(start, end).map(key => `
    <div class="day-row">
      <span class="day-label${key === today ? ' today' : ''}">${key} ${weekdayOf(key)}${key === today ? ' 今天' : ''}</span>
      <input type="text" data-date="${key}" value="${escAttr((plan.dailyNotes && plan.dailyNotes[key]) || '')}" placeholder="记录这一天的内容…">
    </div>`).join('');
  listEl.innerHTML = rows;
}

/* ---------- 短期计划:数据操作 ---------- */
function updateShortPlan(planId, patch) {
  const p = state.shortTermPlans.find(x => x.id === planId);
  if (!p) return;
  Object.assign(p, patch);
  p.updatedAt = new Date().toISOString();
  scheduleSave();
  return p;
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
    periodType: 'year',
    periodValue: String(new Date().getFullYear()),
    tasks: [{ id: uid(), text: '第一个任务点', done: false }],
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

function newShortPlan() {
  const today = todayKey();
  const plan = {
    id: uid(),
    title: '新的短期计划',
    startDate: today,
    endDate: addDays(today, 6),
    tasks: [{ id: uid(), text: '第一个任务点', done: false }],
    note: '',
    dailyNotes: {},
    viewMode: 'calendar',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.shortTermPlans.push(plan);
  renderShort();
  scheduleSave();
  const el = document.querySelector(`.short-card[data-plan-id="${plan.id}"] .plan-title`);
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
  document.getElementById('btnNewShort').addEventListener('click', newShortPlan);

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

    if (e.target.classList.contains('period-type')) {
      plan.periodType = e.target.value;
      if (plan.periodType === 'year') {
        plan.periodValue = String(new Date().getFullYear());
      } else {
        plan.periodValue = `${plan.periodValue.slice(0, 4)}-${pad2(new Date().getMonth() + 1)}`;
      }
      scheduleSave();
      renderLong();
    } else if (e.target.classList.contains('period-year')) {
      const m = plan.periodType === 'month' ? pad2(Number(plan.periodValue.split('-')[1]) || 1) : '';
      plan.periodValue = m ? `${e.target.value}-${m}` : e.target.value;
      scheduleSave();
      renderLong();
    } else if (e.target.classList.contains('period-month')) {
      plan.periodValue = `${plan.periodValue.slice(0, 4)}-${pad2(Number(e.target.value))}`;
      scheduleSave();
      renderLong();
    } else if (e.target.classList.contains('task-check')) {
      const row = e.target.closest('.task-row');
      const task = plan.tasks.find(t => t.id === row.dataset.taskId);
      if (task) {
        task.done = e.target.checked;
        scheduleSave();
        row.classList.toggle('done', task.done);
        updateTaskProgress(card, plan);
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

  /* ---------- 短期计划卡片事件 ---------- */
  document.getElementById('shortList').addEventListener('input', (e) => {
    const card = e.target.closest('.short-card');
    if (!card) return;
    const id = card.dataset.planId;
    if (e.target.classList.contains('plan-title')) {
      updateShortPlan(id, { title: e.target.value });
    } else if (e.target.classList.contains('plan-note')) {
      updateShortPlan(id, { note: e.target.value });
    } else if (e.target.classList.contains('task-text')) {
      // 任务点文本
      const row = e.target.closest('.task-row');
      const p = state.shortTermPlans.find(x => x.id === id);
      const task = p && p.tasks && p.tasks.find(t => t.id === row.dataset.taskId);
      if (task) { task.text = e.target.value; scheduleSave(); }
    } else if (e.target.matches('input[data-date]')) {
      // 列表视图的每日输入
      const key = e.target.dataset.date;
      const p = state.shortTermPlans.find(x => x.id === id);
      if (!p) return;
      if (!p.dailyNotes) p.dailyNotes = {};
      if (e.target.value) p.dailyNotes[key] = e.target.value;
      else delete p.dailyNotes[key];
      scheduleSave();
    }
  });

  /* 短期计划:起止日期(change 事件,避免输入时重绘丢焦点) */
  document.getElementById('shortList').addEventListener('change', (e) => {
    const card = e.target.closest('.short-card');
    if (!card) return;
    const id = card.dataset.planId;
    const plan = state.shortTermPlans.find(x => x.id === id);
    if (!plan) return;
    if (e.target.classList.contains('start-date') || e.target.classList.contains('end-date')) {
      const sv = card.querySelector('.start-date').value;
      const ev = card.querySelector('.end-date').value;
      if (sv && ev && ev < sv) {
        alert('结束日期不能早于开始日期,已自动交换。');
        const tmp = sv; plan.startDate = ev; plan.endDate = tmp;
      } else {
        if (sv) plan.startDate = sv;
        if (ev) plan.endDate = ev;
      }
      plan.updatedAt = new Date().toISOString();
      scheduleSave();
      // 只重绘该卡片的日历/列表区域,不重建整个列表
      renderDailyArea(card, plan);
    } else if (e.target.classList.contains('task-check')) {
      const row = e.target.closest('.task-row');
      const task = plan.tasks && plan.tasks.find(t => t.id === row.dataset.taskId);
      if (task) {
        task.done = e.target.checked;
        scheduleSave();
        row.classList.toggle('done', task.done);
        updateTaskProgress(card, plan);
      }
    }
  });

  document.getElementById('shortList').addEventListener('click', (e) => {
    const card = e.target.closest('.short-card');
    if (!card) return;
    const id = card.dataset.planId;
    const plan = state.shortTermPlans.find(p => p.id === id);
    if (!plan) return;

    if (e.target.classList.contains('btn-delete')) {
      if (confirm('确定删除这个短期计划吗?包括它每一天的记录,删除后不可恢复。')) {
        state.shortTermPlans = state.shortTermPlans.filter(p => p.id !== id);
        delete calState[id];
        scheduleSave();
        renderShort();
      }
    } else if (e.target.classList.contains('btn-add-task')) {
      if (!plan.tasks) plan.tasks = [];
      plan.tasks.push({ id: uid(), text: '新任务点', done: false });
      scheduleSave();
      renderShort();
      const newCard = document.querySelector(`.short-card[data-plan-id="${id}"]`);
      const rows = newCard && newCard.querySelectorAll('.task-row');
      const el = rows && rows[rows.length - 1] && rows[rows.length - 1].querySelector('.task-text');
      if (el) { el.focus(); el.select(); }
    } else if (e.target.classList.contains('task-del')) {
      const row = e.target.closest('.task-row');
      plan.tasks = (plan.tasks || []).filter(t => t.id !== row.dataset.taskId);
      scheduleSave();
      renderShort();
    } else if (e.target.classList.contains('vt-btn')) {
      plan.viewMode = e.target.dataset.mode;
      scheduleSave();
      renderShort();
    } else if (e.target.classList.contains('cal-nav-btn')) {
      const cs = calState[id];
      const delta = Number(e.target.dataset.nav);
      let m = cs.m + delta;
      let y = cs.y;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      calState[id] = { y, m };
      renderCalendar(card, plan);
    } else if (e.target.classList.contains('cal-day') && e.target.dataset.date) {
      const key = e.target.dataset.date;
      if ((!plan.startDate || key >= plan.startDate) && (!plan.endDate || key <= plan.endDate)) {
        openDayModal(id, key);
      }
    }
  });

  /* 每日记录弹层 */
  document.getElementById('dayModalSave').addEventListener('click', () => {
    if (!modalTarget) return;
    const { planId, dateKey } = modalTarget;
    const p = state.shortTermPlans.find(x => x.id === planId);
    if (!p) return;
    const val = document.getElementById('dayModalText').value;
    if (!p.dailyNotes) p.dailyNotes = {};
    if (val.trim()) p.dailyNotes[dateKey] = val;
    else delete p.dailyNotes[dateKey];
    scheduleSave();
    closeDayModal();
    // 局部重绘该卡片的日历/列表
    const card = document.querySelector(`.short-card[data-plan-id="${planId}"]`);
    if (card) renderDailyArea(card, p);
  });

  document.getElementById('dayModalClear').addEventListener('click', () => {
    document.getElementById('dayModalText').value = '';
  });

  document.getElementById('dayModalClose').addEventListener('click', closeDayModal);
  document.getElementById('dayModal').addEventListener('click', (e) => {
    if (e.target.id === 'dayModal') closeDayModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('dayModal').classList.contains('hidden')) {
      closeDayModal();
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
