/* Dungeons and Dragle -- game logic.
 * Loaded on every page, but only does anything on the page that has the game.
 * Needs monsters.js (window.MONSTERS) to be loaded first. */
(function () {
  'use strict';

  const form = document.getElementById('guess-form');
  if (!form || !Array.isArray(window.MONSTERS)) return; // not the game page

  const MAX_GUESSES = 8;
  const MAX_BLUR = 28; // px of blur on the portrait before any guesses
  const STORAGE_KEY = 'dragle-daily-v1';

  const $ = (id) => document.getElementById(id);
  const input = $('guess-input');
  const guessBtn = $('guess-btn');
  const list = $('suggestions');
  const rowsEl = $('guess-rows');
  const msgEl = $('message');
  const countEl = $('guess-count');
  const resultEl = $('result');
  const img = $('monster-img');
  const placeholder = $('portrait-placeholder');
  const noteEl = $('portrait-note');
  $('guess-max').textContent = MAX_GUESSES;

  const monsters = window.MONSTERS;
  const normalize = (s) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
  const byName = new Map(monsters.map((m) => [normalize(m.name), m]));

  let secret, guesses, over, won, mode, dateKey;
  let activeIndex = -1;
  let shown = [];
  let imageLoaded = false;

  /* ---------- helpers ---------- */
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function hash(str) { // FNV-1a
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function save() {
    if (mode !== 'daily') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: dateKey, guesses: guesses.map((g) => g.name), over, won }));
    } catch (e) { /* storage may be blocked; the game still works */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && data.date === dateKey) return data;
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ---------- comparison ---------- */
  function alignParts(a) {
    if (a === 'Unaligned') return null;
    const [first, second] = a.split(' ');
    return second ? [first, second] : ['Neutral', 'Neutral']; // plain "Neutral"
  }

  function compareAlignment(g, s) {
    if (g === s) return 'correct';
    const gp = alignParts(g), sp = alignParts(s);
    if (!gp || !sp) return 'wrong'; // Unaligned only matches Unaligned
    return gp[0] === sp[0] || gp[1] === sp[1] ? 'close' : 'wrong';
  }

  function compareHabitat(g, s) {
    const shared = g.filter((h) => s.includes(h)).length;
    if (shared === g.length && shared === s.length) return 'correct';
    return shared > 0 ? 'close' : 'wrong';
  }

  function compareNumber(g, s) {
    return g === s ? { status: 'correct', arrow: '' } : { status: 'wrong', arrow: s > g ? '\u2191' : '\u2193' };
  }

  function evaluate(g) {
    const cr = compareNumber(g.crValue, secret.crValue);
    const hp = compareNumber(g.hp, secret.hp);
    return [
      { status: g.type === secret.type ? 'correct' : 'wrong', text: g.type },
      { status: cr.status, text: g.cr, arrow: cr.arrow },
      { status: compareHabitat(g.habitat, secret.habitat), text: g.habitat.join(', ') },
      { status: compareAlignment(g.alignment, secret.alignment), text: g.alignment },
      { status: hp.status, text: String(g.hp), arrow: hp.arrow },
    ];
  }

  /* ---------- rendering ---------- */
  function tile(cls, text, arrow, index) {
    const el = document.createElement('div');
    el.className = 'tile ' + cls;
    el.style.setProperty('--i', index);
    if (arrow) {
      const a = document.createElement('span');
      a.className = 'arrow';
      a.textContent = arrow;
      a.setAttribute('aria-label', arrow === '\u2191' ? 'answer is higher' : 'answer is lower');
      el.appendChild(a);
    }
    const t = document.createElement('span');
    t.textContent = text;
    el.appendChild(t);
    if (cls === 'correct' || cls === 'close' || cls === 'wrong') {
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = ' (' + (cls === 'close' ? 'partly right' : cls === 'correct' ? 'match' : 'wrong') + ')';
      el.appendChild(sr);
    }
    return el;
  }

  function addRow(g) {
    const row = document.createElement('div');
    row.className = 'hint-row';
    row.setAttribute('role', 'row');
    row.appendChild(tile('name', g.name, '', 0));
    evaluate(g).forEach((c, i) => row.appendChild(tile(c.status, c.text, c.arrow, i + 1)));
    rowsEl.insertBefore(row, rowsEl.firstChild); // newest guess on top
  }

  function updatePortrait() {
    const blur = over ? 0 : Math.max(0, MAX_BLUR - guesses.length * (MAX_BLUR / MAX_GUESSES));
    img.style.filter = 'blur(' + blur + 'px)';
    if (over) {
      img.alt = secret.name;
      if (!imageLoaded) {
        placeholder.classList.add('revealed');
        placeholder.textContent = secret.name;
        const small = document.createElement('small');
        small.textContent = secret.type + ' \u00b7 CR ' + secret.cr;
        placeholder.appendChild(small);
      }
    }
    countEl.textContent = guesses.length;
    noteEl.textContent = over
      ? (imageLoaded ? 'Portrait revealed!' : 'No portrait for this monster yet.')
      : (imageLoaded ? 'The portrait sharpens with each guess.' : 'The monster stays hidden in the dark...');
  }

  function showMessage(text) { msgEl.textContent = text; }

  function shareText() {
    const icons = { correct: '\ud83d\udfe9', close: '\ud83d\udfe8', wrong: '\ud83d\udfe5' };
    const lines = guesses.map((g) => evaluate(g).map((c) => icons[c.status]).join(''));
    const title = (mode === 'daily' ? 'Dungeons and Dragle ' + dateKey : 'Dungeons and Dragle (random)')
      + ' ' + (won ? guesses.length : 'X') + '/' + MAX_GUESSES;
    return title + '\n' + lines.join('\n');
  }

  function finish() {
    over = true;
    input.disabled = true;
    guessBtn.disabled = true;
    hideSuggestions();
    resultEl.hidden = false;
    $('result-title').textContent = won ? 'Victory!' : 'Defeated...';
    $('result-text').textContent = won
      ? 'You identified the ' + secret.name + ' in ' + guesses.length + (guesses.length === 1 ? ' guess.' : ' guesses.')
      : 'The monster was the ' + secret.name + '.';
    updatePortrait();
  }

  /* ---------- game flow ---------- */
  function setPortrait() {
    imageLoaded = false;
    img.hidden = true;
    img.removeAttribute('src');
    placeholder.hidden = false;
    placeholder.classList.remove('revealed');
    placeholder.textContent = '?';
    img.onload = () => { imageLoaded = true; img.hidden = false; placeholder.hidden = true; updatePortrait(); };
    img.onerror = () => { imageLoaded = false; img.hidden = true; placeholder.hidden = false; updatePortrait(); };
    img.alt = 'The mystery monster, hidden';
    img.src = secret.image;
  }

  function startGame(newMode, forcedSecret) {
    mode = newMode;
    dateKey = todayKey();
    guesses = [];
    over = false;
    won = false;
    rowsEl.textContent = '';
    resultEl.hidden = true;
    input.disabled = false;
    guessBtn.disabled = false;
    input.value = '';
    showMessage('');

    if (forcedSecret) {
      secret = forcedSecret;
    } else if (mode === 'daily') {
      secret = monsters[hash('dragle-' + dateKey) % monsters.length];
    } else {
      secret = monsters[Math.floor(Math.random() * monsters.length)];
    }
    setPortrait();

    if (mode === 'daily') {
      const saved = load();
      if (saved) {
        saved.guesses.forEach((n) => {
          const m = byName.get(normalize(n));
          if (m) { guesses.push(m); addRow(m); }
        });
        if (saved.over) { won = saved.won; finish(); return; }
      }
    }
    updatePortrait();
    input.focus({ preventScroll: true });
  }

  function submitGuess(name) {
    if (over) return;
    const g = byName.get(normalize(name));
    if (!g) {
      showMessage('That monster is not in the list. Pick one from the suggestions.');
      input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
      return;
    }
    if (guesses.includes(g)) { showMessage('You already guessed the ' + g.name + '.'); return; }

    showMessage('');
    guesses.push(g);
    addRow(g);
    input.value = '';
    hideSuggestions();

    if (g === secret) { won = true; save(); finish(); return; }
    if (guesses.length >= MAX_GUESSES) { save(); finish(); return; }
    save();
    updatePortrait();
  }

  /* ---------- autocomplete ---------- */
  function hideSuggestions() {
    list.hidden = true;
    list.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    shown = [];
  }

  function renderSuggestions() {
    const q = normalize(input.value);
    if (!q || over) { hideSuggestions(); return; }
    const pool = monsters.filter((m) => !guesses.includes(m));
    const starts = pool.filter((m) => normalize(m.name).startsWith(q));
    const contains = pool.filter((m) => !normalize(m.name).startsWith(q) && normalize(m.name).includes(q));
    shown = starts.concat(contains).slice(0, 8);
    list.textContent = '';
    if (!shown.length) { hideSuggestions(); return; }
    shown.forEach((m, i) => {
      const li = document.createElement('li');
      li.id = 'sugg-' + i;
      li.setAttribute('role', 'option');
      const n = document.createElement('span'); n.textContent = m.name;
      const s = document.createElement('span'); s.className = 'sub'; s.textContent = m.type;
      li.append(n, s);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); submitGuess(m.name); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }

  function setActive(i) {
    activeIndex = i;
    [...list.children].forEach((li, idx) => li.setAttribute('aria-selected', idx === i ? 'true' : 'false'));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', 'sugg-' + i);
      list.children[i].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  input.addEventListener('input', () => { showMessage(''); renderSuggestions(); });
  input.addEventListener('blur', () => setTimeout(hideSuggestions, 100));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((activeIndex + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeIndex - 1 + shown.length) % shown.length); }
    else if (e.key === 'Escape') { hideSuggestions(); }
    else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); submitGuess(shown[activeIndex].name); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault(); // no server on GitHub Pages: everything happens in the browser
    const typed = input.value.trim();
    if (!typed) return;
    // Allow submitting a unique partial match, e.g. "aboleth" or a single suggestion left.
    if (!byName.has(normalize(typed)) && shown.length === 1) { submitGuess(shown[0].name); return; }
    submitGuess(typed);
  });

  /* ---------- buttons ---------- */
  $('random-btn').addEventListener('click', () => startGame('random'));
  $('again-btn').addEventListener('click', () => startGame('random'));
  $('share-btn').addEventListener('click', async () => {
    const text = shareText();
    const btn = $('share-btn');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
    } catch (e) {
      window.prompt('Copy your result:', text);
    }
    setTimeout(() => { btn.textContent = 'Copy result'; }, 1800);
  });

  startGame('daily');
})();
