import './style.css';
import * as api from './api.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const eventId = params.get('e');
const adminKey = params.get('admin');

// ---------- помощни ----------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const baseUrl = () => location.origin + location.pathname;
const shareLink = (id) => `${baseUrl()}?e=${id}`;
const adminLink = (id, key) => `${baseUrl()}?e=${id}&admin=${key}`;

function snow() {
  const box = document.getElementById('snow');
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = '❄';
    s.style.left = Math.random() * 100 + '%';
    s.style.fontSize = 10 + Math.random() * 18 + 'px';
    s.style.animationDuration = 8 + Math.random() * 12 + 's';
    s.style.animationDelay = -Math.random() * 20 + 's';
    s.style.opacity = 0.3 + Math.random() * 0.6;
    box.appendChild(s);
  }
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Копирано ✓';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    prompt('Копирай линка:', text);
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

// ---------- екран: липсва конфигурация ----------
function renderSetup() {
  app.innerHTML = `
    <section class="card">
      <h1>🎄 Липсва настройка</h1>
      <p>Приложението още не е свързано с базата данни. Следвай <b>README.md</b>, после създай файл <code>.env</code> със <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code> и рестартирай <code>npm run dev</code>.</p>
    </section>`;
}

// ---------- екран: създаване ----------
function renderCreate() {
  app.innerHTML = `
    <section class="card">
      <h1>🎅 Тайният Дядо Коледа</h1>
      <p class="sub">Въведи участниците. Всеки ще изтегли име през общ линк, без никой да знае кой на кого подарява.</p>
      <form id="f">
        <label>Участници <small>(поне 3)</small></label>
        <div id="names"></div>
        <button type="button" class="ghost" id="add">+ Добави човек</button>
        <label for="rules">Правила и описание</label>
        <textarea id="rules" rows="5" placeholder="Напр. Бюджет до 30 лв. Размяна на 24 декември по видео. Подаръкът да е с шега."></textarea>
        <p class="error" id="err" hidden></p>
        <button type="submit" class="primary" id="go">Създай събитието 🎁</button>
      </form>
    </section>`;

  const names = document.getElementById('names');
  const addRow = (value = '') => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<input type="text" maxlength="40" placeholder="Име" value="${esc(value)}" />
      <button type="button" class="x" title="Премахни">✕</button>`;
    row.querySelector('.x').onclick = () => row.remove();
    names.appendChild(row);
  };
  for (let i = 0; i < 4; i++) addRow();
  document.getElementById('add').onclick = () => {
    addRow();
    names.lastElementChild.querySelector('input').focus();
  };

  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.hidden = true;
    const list = [...names.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    const btn = document.getElementById('go');
    btn.disabled = true;
    try {
      const res = await api.createEvent(list, document.getElementById('rules').value);
      renderCreated(res.id, res.admin_key);
    } catch (ex) {
      showError(err, ex.message);
      btn.disabled = false;
    }
  };
}

// ---------- екран: събитието е създадено ----------
function renderCreated(id, key) {
  const pub = shareLink(id);
  const adm = adminLink(id, key);
  app.innerHTML = `
    <section class="card">
      <h1>🎉 Готово!</h1>
      <p class="sub">Изпрати <b>общия линк</b> на всички (и ти го отвори, за да изтеглиш). Админ линка запази само за себе си.</p>
      <label>Общ линк за всички</label>
      <div class="linkbox"><input readonly value="${esc(pub)}" /><button class="primary" data-c="${esc(pub)}">Копирай</button></div>
      <label>Админ линк (само за теб)</label>
      <div class="linkbox"><input readonly value="${esc(adm)}" /><button class="ghost" data-c="${esc(adm)}">Копирай</button></div>
      <p class="hint">Разпределението вече е определено и никой, включително ти, не може да го види. Админ линкът позволява само да промениш правилата и да нулираш забравен PIN.</p>
      <a class="primary linkbtn" href="${esc(pub)}">Към теглилката →</a>
    </section>`;
  app.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => copy(b.dataset.c, b)));
}

// ---------- екран: участник / админ ----------
async function renderEvent() {
  app.innerHTML = `<section class="card"><p class="sub">Зареждане…</p></section>`;
  let ev;
  try {
    ev = await api.getEvent(eventId, adminKey);
  } catch (ex) {
    app.innerHTML = `<section class="card"><h1>Грешка</h1><p>${esc(ex.message)}</p></section>`;
    return;
  }
  if (!ev) {
    app.innerHTML = `<section class="card"><h1>Не намерихме събитието 😕</h1><p>Провери дали линкът е пълен.</p></section>`;
    return;
  }

  const drawn = ev.people.filter((p) => p.drawn).length;
  const total = ev.people.length;
  const waiting = ev.people.filter((p) => !p.drawn).map((p) => p.name);

  app.innerHTML = `
    <section class="card">
      <h1>🎅 Тайният Дядо Коледа</h1>
      <div class="progress"><div style="width:${(drawn / total) * 100}%"></div></div>
      <p class="sub">Изтеглили: <b>${drawn}</b> от <b>${total}</b>${
        waiting.length ? ' · Чакаме: ' + waiting.map(esc).join(', ') : ' · Всички са изтеглили! 🎉'
      }</p>
      <label for="who">Кой си ти?</label>
      <select id="who">
        <option value="">— избери името си —</option>
        ${ev.people
          .map(
            (p) =>
              `<option value="${p.id}" data-drawn="${p.drawn}">${esc(p.name)}${p.drawn ? ' (вече изтегли/а)' : ''}${p.locked ? ' 🔒' : ''}</option>`,
          )
          .join('')}
      </select>
      <div id="pinbox" hidden>
        <label for="pin" id="pinlabel">PIN</label>
        <input id="pin" type="text" inputmode="numeric" maxlength="4" placeholder="4 цифри" autocomplete="off" />
        <p class="hint" id="pinhint"></p>
        <p class="error" id="err" hidden></p>
        <button class="primary" id="draw">Изтегли 🎁</button>
      </div>
      <div id="result"></div>
    </section>
    <section class="card">
      <h2>📜 Правила и описание</h2>
      ${
        ev.is_admin
          ? `<textarea id="rules" rows="6">${esc(ev.rules)}</textarea>
             <button class="ghost" id="saverules">Запази правилата</button>
             <p class="ok" id="saved" hidden>Запазено ✓</p>`
          : `<p class="rules">${ev.rules ? esc(ev.rules) : '<i>Няма добавено описание.</i>'}</p>`
      }
    </section>
    ${
      ev.is_admin
        ? `<section class="card"><h2>🔧 Админ</h2>
            <p class="hint">Забравил PIN или заключено име? Нулирай го, човекът ще зададе нов PIN и ще види същия получател.</p>
            ${ev.people
              .filter((p) => p.drawn)
              .map((p) => `<div class="row between"><span>${esc(p.name)}</span><button class="ghost" data-reset="${p.id}">Нулирай</button></div>`)
              .join('') || '<p class="hint">Още никой не е тегли.</p>'}
          </section>`
        : ''
    }`;

  const who = document.getElementById('who');
  const pinbox = document.getElementById('pinbox');
  const pin = document.getElementById('pin');
  const err = document.getElementById('err');

  who.onchange = () => {
    err.hidden = true;
    document.getElementById('result').innerHTML = '';
    const opt = who.selectedOptions[0];
    pinbox.hidden = !who.value;
    if (!who.value) return;
    const was = opt.dataset.drawn === 'true';
    document.getElementById('pinlabel').textContent = was ? 'Въведи своя PIN, за да видиш пак' : 'Измисли си 4-цифрен PIN';
    document.getElementById('pinhint').textContent = was
      ? 'Вече си тегли/а. С PIN-а си виждаш същото име.'
      : 'Запомни го! Само с него ще можеш да видиш името си отново. Теглилката е еднократна.';
    document.getElementById('draw').textContent = was ? 'Покажи ми пак' : 'Изтегли 🎁';
    pin.value = '';
    // след затваряне на падащото меню браузърът понякога връща фокуса на него
    setTimeout(() => pin.focus(), 50);
  };

  document.getElementById('draw').onclick = async () => {
    err.hidden = true;
    if (!/^\d{4}$/.test(pin.value)) return showError(err, 'PIN трябва да е точно 4 цифри');
    const btn = document.getElementById('draw');
    btn.disabled = true;
    try {
      const r = await api.reveal(who.value, pin.value);
      showResult(r, ev.people.find((p) => p.id === who.value).name);
    } catch (ex) {
      showError(err, ex.message);
      btn.disabled = false;
    }
  };
  pin.oninput = () => (pin.value = pin.value.replace(/\D/g, '').slice(0, 4));
  pin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('draw').click();
  });

  if (ev.is_admin) {
    document.getElementById('saverules').onclick = async () => {
      await api.updateRules(eventId, adminKey, document.getElementById('rules').value);
      const s = document.getElementById('saved');
      s.hidden = false;
      setTimeout(() => (s.hidden = true), 1500);
    };
    app.querySelectorAll('[data-reset]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Да нулирам ли PIN-а на този човек?')) return;
        await api.resetPerson(eventId, adminKey, b.dataset.reset);
        renderEvent();
      };
    });
  }
}

function showResult(r, myName) {
  document.getElementById('pinbox').hidden = true;
  document.getElementById('who').disabled = true;
  const out = document.getElementById('result');
  out.innerHTML = `
    <div class="reveal">
      <p class="sub">${esc(myName)}, ти подаряваш на…</p>
      <div class="gift">🎁</div>
      <div class="bigname" id="bigname">${esc(r.receiver)}</div>
      <p class="hint">Не казвай на никого! Правилата са по-долу 👇</p>
    </div>`;
  out.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- старт ----------
snow();
if (!api.configured) renderSetup();
else if (eventId) renderEvent();
else renderCreate();
