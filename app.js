/* ---------- constants ---------- */
const HABITS = [
  { key: 'gym',   label: 'Gym',    emo: '\u{1F3CB}️', color: 'var(--coral)', max: 30 },
  { key: 'eat',   label: 'Eating', emo: '\u{1F957}',       color: 'var(--mint)',  max: 25 },
  { key: 'work',  label: 'Work',   emo: '\u{1F4BC}',       color: 'var(--sky)',   max: 25 },
  { key: 'water', label: 'Water',  emo: '\u{1F4A7}',       color: 'var(--sun)',   max: 10 },
  { key: 'sleep', label: 'Sleep',  emo: '\u{1F634}',       color: 'var(--grape)', max: 10 },
];
const CONFETTI = ['#ff6b57', '#1fb888', '#2f9bff', '#ffb800', '#8b5cf6'];
const GYM_TYPES = ['Lift', 'Run', 'Class', 'Walk', 'Other'];
const EAT_LABELS = ['', 'Rough', 'Okay', 'Great'];
const LEVELS = ['Just starting', 'Warming up', 'Finding rhythm', 'Showing up', 'Steady', 'In the groove',
  'Locked in', 'Unshakeable', 'Relentless', 'The long game'];
const PERFECT_BONUS = 40;
const NUDGES = [
  'Small and done beats perfect and postponed.',
  'You don’t need motivation. You need the next ten minutes.',
  'Future you is watching how today goes.',
  'Consistency is just showing up on the boring days.',
  'Do the easy version. Then see if you feel like more.',
  'A missed day is a data point, not a verdict.',
  'The workout you do beats the perfect one you plan.',
  'Eat like you like yourself.',
  'Start before you feel ready.',
  'Momentum is cheaper than willpower.',
  'One good meal. One good hour. One good set.',
  'Nobody regrets the workout once it’s over.',
  'Protect the streak, but don’t be its hostage.',
  'Progress is quiet. Keep going anyway.',
  'Make it small enough that you can’t say no.',
  'Rest is part of the plan, not a break from it.',
  'You are building a person, one day at a time.',
  'Focus for one block. Then one more.',
  'Drink the water. Take the walk. Send the email.',
  'Today counts, whatever yesterday was.',
  'Be a little better than your last good day.',
];
const DEFAULT = () => ({
  name: '',
  goals: { gymPerWeek: 4, eatDaysPerWeek: 5, workPerDay: 6, water: 8, sleep: 8, kcal: 2000, protein: 100 },
  profile: { sex: 'm', age: '', height: '', weight: '', activity: 1.375, pace: 0.5 },
  foods: [],
  quick: {},
  // One-tap meals you eat all the time. Numbers are estimates: edit by deleting and re-saving from the Quick tab.
  presets: [{ id: 'p-breakfast', meal: 'Breakfast', name: 'Cornflakes, soy milk, black coffee', kcal: 230, p: 10, f: 4, c: 36 }],
  days: {},
  custom: [],
  badges: {},
  rewards: [
    { id: 'r1', level: 3,  emo: '☕', text: 'Fancy coffee and a pastry', claimed: '' },
    { id: 'r2', level: 5,  emo: '\u{1F3AC}', text: 'Movie night, snacks included', claimed: '' },
    { id: 'r3', level: 10, emo: '\u{1F4B6}', text: '€100: save it, or dinner out', claimed: '' },
  ],
});
const norm = (d) => ({ ...DEFAULT(), ...d, goals: { ...DEFAULT().goals, ...(d && d.goals) }, badges: (d && d.badges) || {},
  profile: { ...DEFAULT().profile, ...(d && d.profile) }, foods: Array.isArray(d && d.foods) ? d.foods : [], quick: (d && d.quick) || {},
  presets: Array.isArray(d && d.presets) ? d.presets : DEFAULT().presets,
  rewards: Array.isArray(d && d.rewards) ? d.rewards : DEFAULT().rewards });

/* ---------- state ---------- */
let S = DEFAULT();
let selected = key(new Date());
let cursor = startOfMonth(new Date());
let saveTimer, serverOk = false, cloud = null, lastPt = null, ready = false;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- storage: Firebase (if configured) -> local server -> localStorage ---------- */
async function load() {
  let data = null;
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (r.ok) { data = await r.json(); serverOk = true; } else if (r.status === 404) serverOk = true;
  } catch { /* not running under server.js */ }
  if (!data || !data.goals) { try { data = JSON.parse(localStorage.getItem('steady') || 'null') || data; } catch {} }
  if (data && data.goals) S = norm(data);
  ready = true;
  status();
  render();
  syncBadges(true);
  initCloud();
}
function status(extra) {
  $('saveState').textContent = extra || (cloud && cloud.user ? `Synced to your account (${cloud.user.email}).`
    : serverOk ? 'Saved to data.json on this Mac.' : 'Saving in this browser only.');
}
function save() {
  try { localStorage.setItem('steady', JSON.stringify(S)); } catch {}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (cloud && cloud.user) {
      try { await cloud.write(JSON.parse(JSON.stringify(S))); status(); } catch { status('Offline — will sync when you’re back.'); }
    } else if (serverOk && !cloud) {
      try { await fetch('/api/data', { method: 'PUT', body: JSON.stringify(S) }); } catch { status('Couldn’t reach the server.'); }
    }
  }, 400);
}

async function initCloud() {
  let cfg;
  try { cfg = (await import('./firebase-config.js')).default; } catch {}
  if (!cfg || !cfg.apiKey) return;
  const V = '10.14.1', base = `https://www.gstatic.com/firebasejs/${V}/`;
  try {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
    ]);
    const app = initializeApp(cfg);
    const auth = A.getAuth(app);
    const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() });
    cloud = { user: null, write: null, unsub: null, signOut: () => A.signOut(auth) };
    $('signIn').onclick = async () => {
      const p = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, p); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') A.signInWithRedirect(auth, p);
        else $('authMsg').textContent = 'Sign-in didn’t work. Try again?';
      }
    };
    A.onAuthStateChanged(auth, (user) => {
      if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
      cloud.user = user;
      $('auth').hidden = !!user;
      if (!user) { cloud.write = null; status(); render(); return; }
      const ref = F.doc(db, 'users', user.uid);
      cloud.write = (d) => F.setDoc(ref, d);
      cloud.unsub = F.onSnapshot(ref, (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists()) { S = norm(snap.data()); try { localStorage.setItem('steady', JSON.stringify(S)); } catch {} syncBadges(true); render(); status(); }
        else { cloud.write(JSON.parse(JSON.stringify(S))).then(() => status()); } // first sign-in: upload what's here
      }, () => status('Couldn’t sync. Check your Firestore rules.'));
    });
  } catch { status('Couldn’t load Firebase — using local data.'); }
}

/* ---------- date helpers ---------- */
function key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const TODAY = () => key(new Date());
const fmtLong = (k) => parse(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/* ---------- habit logic ---------- */
const day = (k) => S.days[k] || {};
function met(h, k) {
  const d = day(k), g = S.goals;
  switch (h) {
    case 'gym': return !!(d.gym || d.rest);
    case 'eat': return (d.eat || 0) >= 2 || foodOnTarget(k);
    case 'work': return (d.work || 0) >= g.workPerDay;
    case 'water': return (d.water || 0) >= g.water;
    case 'sleep': return (d.sleep || 0) >= g.sleep;
  }
}
/* ---------- food ---------- */
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const r1 = (n) => Math.round((+n || 0) * 10) / 10;
function foodTotals(k) {
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const e of day(k).food || []) { t.kcal += e.kcal; t.p += e.p; t.f += e.f; t.c += e.c; }
  return { kcal: Math.round(t.kcal), p: r1(t.p), f: r1(t.f), c: r1(t.c) };
}
// Not over the goal, and the day looks properly fed: either close to the goal, or at least 3 different meals
// logged (canteen/restaurant meals are estimates, so the numbers alone can't tell a light day from an untracked one).
const mealsLogged = (k) => new Set((day(k).food || []).map((e) => e.meal)).size;
function foodOnTarget(k) {
  const e = day(k).food; if (!e || !e.length) return false;
  const t = foodTotals(k).kcal, goal = S.goals.kcal;
  return t <= goal * 1.05 && (t >= goal * 0.75 || mealsLogged(k) >= 3);
}
const defaultMeal = () => { const h = new Date().getHours(); return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack'; };
function foodMsg(k) {
  const e = day(k).food || [], t = foodTotals(k).kcal, goal = S.goals.kcal;
  if (!e.length) return 'Nothing logged yet. Scan your first meal!';
  if (t > goal * 1.05) return `Over by ${t - goal} kcal. No drama: one day doesn’t undo the week. Reset at the next meal.`;
  if (foodOnTarget(k)) return t >= goal * 0.75 ? 'Right in the zone. That’s how a steady deficit gets built.' : 'All your meals are logged and you’re under target. Solid day.';
  if (k === TODAY() && new Date().getHours() < 18) return `${goal - t} kcal left. Plenty of room for a proper meal.`;
  return 'Looks like a meal is missing. Use Quick add for a rough estimate (canteen, restaurant) so the day adds up.';
}
// Mifflin-St Jeor estimate. Pace is kg/week (about 1100 kcal/day per kg/week), never below a basic minimum.
function calc() {
  const p = S.profile, w = +p.weight, h = +p.height, a = +p.age;
  if (!(w > 0 && h > 0 && a > 0)) return null;
  const tdee = (10 * w + 6.25 * h - 5 * a + (p.sex === 'f' ? -161 : 5)) * +p.activity;
  const deficit = Math.round(+p.pace * 1100), floor = p.sex === 'f' ? 1200 : 1500, raw = tdee - deficit;
  return { tdee: Math.round(tdee / 10) * 10, deficit, target: Math.max(floor, Math.round(raw / 10) * 10), floored: raw < floor, floor, protein: Math.round(1.6 * w) };
}

const questsDone = (k) => HABITS.filter((h) => met(h.key, k)).length;
const perfect = (k) => questsDone(k) === HABITS.length;
function weekStats(monday) {
  let gym = 0, eat = 0, work = 0, water = 0, sleep = 0;
  for (let i = 0; i < 7; i++) {
    const k = key(addDays(monday, i)), d = day(k);
    if (d.gym) gym++;
    if (met('eat', k)) eat++;
    work += d.work || 0;
    if (met('water', k)) water++;
    if (met('sleep', k)) sleep++;
  }
  return { gym, eat, work, water, sleep };
}
// Daily streak with one grace day; weekends are neutral for work.
function dailyStreak(h) {
  let n = 0, grace = 1, d = new Date();
  if (!met(h, key(d))) d = addDays(d, -1); // today still in progress
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    const k = key(d);
    if (met(h, k)) { n++; continue; }
    if (h === 'work' && [0, 6].includes(d.getDay()) && !day(k).work) continue;
    if (grace-- > 0 && n > 0) continue;
    break;
  }
  return n;
}
// Gym streak counts weeks that hit the weekly goal (rest days are part of it).
function gymStreak() {
  let n = 0, w = startOfWeek(new Date());
  if (weekStats(w).gym >= S.goals.gymPerWeek) n++;
  w = addDays(w, -7);
  for (let i = 0; i < 100; i++, w = addDays(w, -7)) {
    if (weekStats(w).gym >= S.goals.gymPerWeek) n++; else break;
  }
  return n;
}
function streakText(h) {
  if (h === 'gym') { const n = gymStreak(); return n ? `\u{1F525} <b>${n}</b> week${n > 1 ? 's' : ''} on target` : 'hit your weekly goal to light a streak'; }
  const n = dailyStreak(h);
  return n ? `\u{1F525} <b>${n}</b> day${n > 1 ? 's' : ''} in a row` : 'start a streak today';
}

/* ---------- XP / levels ---------- */
function habitXp(h, k) {
  const d = day(k), g = S.goals;
  switch (h) {
    case 'gym': return d.gym ? 30 : d.rest ? 10 : 0;
    case 'eat': return Math.max([0, 5, 15, 25][d.eat || 0], foodOnTarget(k) ? 25 : 0);
    case 'work': return Math.min(1, (d.work || 0) / g.workPerDay) * 25;
    case 'water': return Math.min(1, (d.water || 0) / g.water) * 10;
    case 'sleep': return Math.min(1, (d.sleep || 0) / g.sleep) * 10;
  }
}
const dayXp = (k) => HABITS.reduce((s, h) => s + habitXp(h.key, k), 0) + (perfect(k) ? PERFECT_BONUS : 0);
function totalXp() {
  let t = 0;
  for (const k in S.days) t += dayXp(k);
  t += S.custom.filter((c) => c.done).length * 50;
  return Math.round(t);
}
function levelInfo(xp) {
  let lvl = 1, need = 100, left = xp;
  while (left >= need) { left -= need; lvl++; need = 100 + (lvl - 1) * 40; }
  return { lvl, into: left, need, name: LEVELS[Math.min(lvl - 1, LEVELS.length - 1)] };
}

/* ---------- rewards ---------- */
// Total xp needed to reach a level (inverse of levelInfo).
function xpToReach(lvl) { let t = 0; for (let l = 1; l < lvl; l++) t += 100 + (l - 1) * 40; return t; }
const sortedRewards = () => [...S.rewards].sort((a, b) => a.level - b.level);
const nextReward = () => sortedRewards().find((r) => !r.claimed && r.level > levelInfo(totalXp()).lvl);

/* ---------- badges ---------- */
const count = (fn) => Object.keys(S.days).filter(fn).length;
const BADGES = [
  { id: 'first',   emo: '\u{1F4AA}', name: 'First rep',      desc: 'Log a workout',                 c: 'var(--coral)', ok: () => count((k) => day(k).gym) >= 1 },
  { id: 'gymweek', emo: '\u{1F947}', name: 'Weekly win',     desc: 'Hit a weekly gym goal',         c: 'var(--coral)', ok: () => gymStreak() >= 1 },
  { id: 'gym10',   emo: '\u{1F3CB}️', name: 'Ten strong', desc: '10 workouts logged',          c: 'var(--coral)', ok: () => count((k) => day(k).gym) >= 10 },
  { id: 'gym50',   emo: '\u{1F525}', name: 'Fifty club',     desc: '50 workouts logged',            c: 'var(--coral)', ok: () => count((k) => day(k).gym) >= 50 },
  { id: 'streak3', emo: '⚡',    name: 'On a roll',      desc: '3-day streak on any habit',     c: 'var(--sun)',   ok: () => topStreak() >= 3 },
  { id: 'streak7', emo: '\u{1F5D3}️', name: 'Week warrior', desc: '7-day streak on any habit',  c: 'var(--sun)',   ok: () => topStreak() >= 7 },
  { id: 'streak30', emo: '\u{1F680}', name: 'Unstoppable',   desc: '30-day streak on any habit',    c: 'var(--sun)',   ok: () => topStreak() >= 30 },
  { id: 'perfect', emo: '\u{1F31F}', name: 'Perfect day',    desc: 'Complete all five quests',      c: 'var(--sun)',   ok: () => count(perfect) >= 1 },
  { id: 'perfect5', emo: '\u{1F3C6}', name: 'Five perfect',  desc: '5 perfect days',                c: 'var(--sun)',   ok: () => count(perfect) >= 5 },
  { id: 'eat7',    emo: '\u{1F957}', name: 'Good fuel',      desc: '7 days of good eating',         c: 'var(--mint)',  ok: () => count((k) => met('eat', k)) >= 7 },
  { id: 'hours50', emo: '\u{1F9E0}', name: 'Deep worker',    desc: '50 hours of work logged',       c: 'var(--sky)',   ok: () => Object.values(S.days).reduce((s, d) => s + (d.work || 0), 0) >= 50 },
  { id: 'food1',  emo: '\u{1F50D}', name: 'Label reader',   desc: 'Log your first food',           c: 'var(--mint)',  ok: () => count((k) => (day(k).food || []).length) >= 1 },
  { id: 'food7',  emo: '\u{1F4D2}', name: 'Honest tracker', desc: 'Log food on 7 days',            c: 'var(--mint)',  ok: () => count((k) => (day(k).food || []).length) >= 7 },
  { id: 'zone7',  emo: '\u{1F3AF}', name: 'In the zone',    desc: '7 days on calorie target',      c: 'var(--mint)',  ok: () => count(foodOnTarget) >= 7 },
  { id: 'water7', emo: '\u{1F4A7}', name: 'Hydrated',       desc: '7 days at your water goal',     c: 'var(--sun)',   ok: () => count((k) => met('water', k)) >= 7 },
  { id: 'sleep7',  emo: '\u{1F319}', name: 'Well rested',    desc: '7 days at your sleep goal',     c: 'var(--grape)', ok: () => count((k) => met('sleep', k)) >= 7 },
  { id: 'goal',    emo: '\u{1F3AF}', name: 'Goal getter',    desc: 'Finish a personal goal',        c: 'var(--mint)',  ok: () => S.custom.some((c) => c.done) },
  { id: 'lvl5',    emo: '\u{1F451}', name: 'Level 5',        desc: 'Reach level 5',                 c: 'var(--grape)', ok: () => levelInfo(totalXp()).lvl >= 5 },
];
const topStreak = () => Math.max(...HABITS.filter((h) => h.key !== 'gym').map((h) => dailyStreak(h.key)));
function syncBadges(silent) {
  const won = [];
  for (const b of BADGES) if (!S.badges[b.id] && b.ok()) { S.badges[b.id] = TODAY(); won.push(b); }
  if (!won.length) return;
  save();
  if (!silent) { won.forEach((b) => toast(`${b.emo} Badge unlocked: ${b.name}`)); burst(80); }
}

/* ---------- fun: toast queue, confetti, buddy ---------- */
const toasts = []; let toasting = false;
function toast(msg) { toasts.push(msg); if (!toasting) nextToast(); }
function nextToast() {
  const m = toasts.shift(); if (!m) { toasting = false; return; }
  toasting = true; const t = $('toast'); t.textContent = m; t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(nextToast, 350); }, 1700);
}
let parts = [], raf = 0;
function burst(n = 40) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('fx'); c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  const ox = (lastPt ? lastPt.x : innerWidth / 2) * devicePixelRatio, oy = (lastPt ? lastPt.y : innerHeight / 2) * devicePixelRatio;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 9) * devicePixelRatio;
    parts.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * devicePixelRatio, r: (4 + Math.random() * 5) * devicePixelRatio,
      c: CONFETTI[i % 5], rot: Math.random() * 6, vr: Math.random() * .4 - .2, life: 0, sq: Math.random() > .5 });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  const c = $('fx'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  parts = parts.filter((p) => p.life < 90 && p.y < c.height + 50);
  for (const p of parts) {
    p.life++; p.x += p.vx; p.y += p.vy; p.vy += .35 * devicePixelRatio; p.vx *= .985; p.rot += p.vr;
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, (90 - p.life) / 25); g.fillStyle = p.c;
    if (p.sq) g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); else { g.beginPath(); g.arc(0, 0, p.r / 2, 0, 7); g.fill(); }
    g.restore();
  }
  raf = parts.length ? requestAnimationFrame(tick) : 0;
  if (!raf) g.clearRect(0, 0, c.width, c.height);
}
function buddySvg(mood, color) {
  const eyes = [
    '<path d="M32 46h10M58 46h10" stroke="#2b2140" stroke-width="4" stroke-linecap="round"/>',
    '<circle cx="37" cy="46" r="4.5" fill="#2b2140"/><circle cx="63" cy="46" r="4.5" fill="#2b2140"/>',
    '<circle cx="37" cy="45" r="6" fill="#2b2140"/><circle cx="63" cy="45" r="6" fill="#2b2140"/><circle cx="39" cy="43" r="2" fill="#fff"/><circle cx="65" cy="43" r="2" fill="#fff"/>',
    '<text x="37" y="53" font-size="20" text-anchor="middle" fill="#2b2140">★</text><text x="63" y="53" font-size="20" text-anchor="middle" fill="#2b2140">★</text>',
  ][mood];
  const mouth = [
    '<path d="M44 66h12" stroke="#2b2140" stroke-width="4" stroke-linecap="round"/>',
    '<path d="M42 64q8 7 16 0" stroke="#2b2140" stroke-width="4" fill="none" stroke-linecap="round"/>',
    '<path d="M38 62q12 16 24 0z" fill="#2b2140"/>',
    '<path d="M38 62q12 18 24 0z" fill="#2b2140"/><path d="M45 68q5 4 10 0" stroke="#ff6b57" stroke-width="3" fill="none"/>',
  ][mood];
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 7C76 7 93 27 93 54c0 25-19 40-43 40S7 79 7 54C7 27 24 7 50 7Z" fill="${color}" stroke="#2b2140" stroke-width="4"/>
    <ellipse cx="30" cy="59" rx="6" ry="4" fill="#fff" opacity=".35"/><ellipse cx="70" cy="59" rx="6" ry="4" fill="#fff" opacity=".35"/>${eyes}${mouth}</svg>`;
}

/* ---------- mutations ---------- */
function update(k, patch) {
  const before = totalXp(), lvBefore = levelInfo(before).lvl;
  const metBefore = HABITS.filter((h) => met(h.key, k)).map((h) => h.key), wasPerfect = perfect(k);
  S.days[k] = { ...day(k), ...patch };
  const d = S.days[k];
  if (!d.gym && !d.rest && !d.eat && !d.work && !d.water && !d.sleep && !(d.food && d.food.length)) delete S.days[k];
  const after = totalXp(), info = levelInfo(after);
  const newlyMet = HABITS.filter((h) => met(h.key, k) && !metBefore.includes(h.key));
  if (newlyMet.length) burst(28);
  if (!wasPerfect && perfect(k)) { toast(`\u{1F31F} Perfect day! +${PERFECT_BONUS} bonus xp`); burst(110); }
  else if (info.lvl > lvBefore) {
    toast(`\u{1F389} Level ${info.lvl}: ${info.name}`); burst(120);
    S.rewards.filter((r) => !r.claimed && r.level > lvBefore && r.level <= info.lvl).forEach((r) => toast(`\u{1F381} Reward unlocked: ${r.text}`));
  }
  else if (after - before >= 5) toast(`+${after - before} xp`);
  syncBadges(false);
  save(); render();
}

/* ---------- render: header ---------- */
function renderHeader() {
  const now = new Date(), h = now.getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('dateLine').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('greeting').textContent = S.name ? `${part}, ${S.name}!` : `${part}!`;
  $('nudge').textContent = NUDGES[Math.floor(now / 864e5) % NUDGES.length];
  const xp = totalXp(), L = levelInfo(xp), n = questsDone(TODAY());
  $('lvlNum').textContent = `Lv ${L.lvl}`;
  $('lvlName').textContent = L.name;
  $('lvlBar').style.width = (L.into / L.need * 100) + '%';
  $('lvlText').textContent = `${L.into} / ${L.need} xp to level ${L.lvl + 1}`;
  const mood = n === 5 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
  const svg = buddySvg(mood, CONFETTI[(L.lvl - 1) % 5]);
  $('buddy').innerHTML = svg; $('authBuddy').innerHTML = buddySvg(2, CONFETTI[0]);
}

/* ---------- render: day card ---------- */
function renderDay() {
  const k = selected, d = day(k), g = S.goals, isToday = k === TODAY(), done = questsDone(k);
  const row = (h, controls, extra = '', sub = '') => {
    const xp = Math.round(habitXp(h.key, k));
    return `<div class="habit ${met(h.key, k) ? 'ok' : ''}" style="--c:${h.color}">
      <div><div class="habit-name"><span class="emo">${h.emo}</span>${h.label}<span class="xp">${xp}/${h.max} xp</span></div>
        <div class="streak">${streakText(h.key)}</div></div>
      ${controls}${extra}${sub}
    </div>`;
  };
  const stepper = (field, val, unit) => `
    <div class="stepper">
      <button data-step="${field}" data-by="-1" aria-label="less ${field}">−</button>
      <output>${val}<small> ${unit}</small></output>
      <button data-step="${field}" data-by="1" aria-label="more ${field}">+</button>
    </div>`;
  const pips = (val, goal) => `<div class="pips">${Array.from({ length: Math.max(goal, val) }, (_, i) => `<i class="${i < val ? 'f' : ''}"></i>`).join('')}</div>`;
  const meter = (val, goal) => `<div class="meter"><i style="width:${Math.min(100, val / goal * 100)}%"></i></div>`;
  const gymSub = `<div class="sub" style="--c:${HABITS[0].color}">${d.gym
    ? GYM_TYPES.map((t) => `<button class="chip ${d.gymType === t ? 'on' : ''}" data-gymtype="${t}">${t}</button>`).join('')
    : `<button class="chip ${d.rest ? 'on' : ''}" data-rest>\u{1F60C} Rest day</button>`}</div>`;

  $('dayCard').innerHTML = `
    <div class="card-head"><h2>${isToday ? 'Today’s quests' : fmtLong(k)}</h2>
      ${isToday ? '' : '<button class="dayjump" data-today>Back to today</button>'}</div>
    <div class="questbar"><div class="bar"><i style="width:${done / 5 * 100}%"></i></div><b>${done}/5</b></div>
    ${perfect(k) ? `<div class="perfect-banner">\u{1F31F} Perfect day! +${PERFECT_BONUS} bonus xp</div>` : ''}
    ${row(HABITS[0], `<button class="toggle ${d.gym ? 'on' : ''}" data-toggle="gym" role="switch" aria-checked="${!!d.gym}" aria-label="Gym done"></button>`, gymSub)}
    ${row(HABITS[1], `<div class="seg" style="--c:${HABITS[1].color}">${[1, 2, 3].map((n) => `<button class="${d.eat === n ? 'on' : ''}" data-eat="${n}">${EAT_LABELS[n]}</button>`).join('')}</div>`)}
    ${row(HABITS[2], stepper('work', d.work || 0, `/ ${g.workPerDay}h`), meter(d.work || 0, g.workPerDay))}
    ${row(HABITS[3], stepper('water', d.water || 0, `/ ${g.water}`), pips(d.water || 0, g.water))}
    ${row(HABITS[4], stepper('sleep', d.sleep || 0, `/ ${g.sleep}h`), meter(d.sleep || 0, g.sleep))}`;
}

/* ---------- render: week rings ---------- */
function ring(label, val, goal, color, text, sub) {
  const R = 42, C = 2 * Math.PI * R, p = Math.min(1, goal ? val / goal : 0);
  return `<div style="--c:${color}">
    <div class="ring"><svg viewBox="0 0 100 100"><circle class="t" cx="50" cy="50" r="${R}"/><circle class="p" cx="50" cy="50" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>
    <div class="ring-val"><span>${text}<small>${sub}</small></span></div></div>
    <div class="ring-label">${label}</div></div>`;
}
function renderWeek() {
  const g = S.goals, w = weekStats(startOfWeek(new Date())), wt = g.workPerDay * 5;
  const mini = (label, n, color) => `<div class="mini-row" style="--c:${color}"><span>${label}</span><div class="meter"><i style="width:${n / 7 * 100}%"></i></div><span class="tiny">${n}/7</span></div>`;
  $('weekCard').innerHTML = `
    <div class="card-head"><h2>This week</h2><span class="tiny">Monday to Sunday</span></div>
    <div class="rings">
      ${ring('Gym', w.gym, g.gymPerWeek, 'var(--coral)', `${w.gym}`, `of ${g.gymPerWeek}`)}
      ${ring('Eating', w.eat, g.eatDaysPerWeek, 'var(--mint)', `${w.eat}`, `of ${g.eatDaysPerWeek} days`)}
      ${ring('Work', w.work, wt, 'var(--sky)', `${+w.work.toFixed(1)}`, `of ${wt}h`)}
    </div>
    <div class="mini">${mini('Water', w.water, 'var(--sun)')}${mini('Sleep', w.sleep, 'var(--grape)')}</div>`;
}

/* ---------- render: calendar ---------- */
function renderCal() {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = (cursor.getDay() + 6) % 7, total = new Date(y, m + 1, 0).getDate(), today = TODAY();
  let cells = '', gym = 0, work = 0, stars = 0;
  for (let i = 0; i < first; i++) cells += '<div class="day blank"></div>';
  for (let n = 1; n <= total; n++) {
    const k = key(new Date(y, m, n)), d = day(k), future = k > today, pf = perfect(k);
    if (d.gym) gym++;
    work += d.work || 0;
    if (pf) stars++;
    const dots = HABITS.filter((h) => met(h.key, k)).map((h) => `<i style="--c:${h.color}"></i>`).join('');
    cells += `<button class="day ${k === today ? 'today' : ''} ${k === selected ? 'sel' : ''} ${pf ? 'perfect' : ''}" data-day="${k}" ${future ? 'disabled' : ''} aria-label="${fmtLong(k)}"><span class="n">${n}</span><span class="dots">${pf ? '⭐' : dots}</span></button>`;
  }
  $('calCard').innerHTML = `
    <div class="card-head"><h2>${cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <div class="cal-nav"><button data-cal="-1" aria-label="Previous month">‹</button><button data-cal="1" aria-label="Next month">›</button></div></div>
    <div class="dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="days">${cells}</div>
    <div class="legend">${HABITS.map((h) => `<span style="--c:${h.color}"><i class="dot"></i>${h.label}</span>`).join('')}<span>⭐ Perfect</span></div>
    <div class="month-sum"><span><b>${gym}</b>workouts</span><span><b>${+work.toFixed(1)}</b>hours worked</span><span><b>${stars}</b>perfect days</span></div>`;
}

/* ---------- render: focus / custom goals / badges ---------- */
function goalRow(c) {
  const due = c.due ? `<span class="tiny">${parse(c.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` : '';
  return `<div class="goal ${c.done ? 'done' : ''}"><button class="check ${c.done ? 'on' : ''}" data-goal="${c.id}" aria-label="Toggle goal">${c.done ? '✓' : ''}</button>
    <span class="txt">${esc(c.text)}</span>${due}<button class="x" data-del="${c.id}" aria-label="Delete goal">×</button></div>`;
}
function renderFocus() {
  const open = S.custom.filter((c) => !c.done).slice(0, 4);
  $('focusCard').innerHTML = `
    <div class="card-head"><h2>\u{1F3AF} Focus</h2><button class="dayjump" data-view="goals">Manage</button></div>
    ${open.length ? open.map(goalRow).join('') : '<p class="empty">Nothing set. Add a goal worth 50 xp.</p>'}`;
}
function calBarColor(k) {
  const t = foodTotals(k).kcal, g = S.goals.kcal;
  return t > g * 1.05 ? 'var(--coral)' : t >= g * 0.75 ? 'var(--mint)' : 'var(--sun)';
}
// One-tap preset chips, hiding any already logged on this day.
function presetChips(k) {
  const used = new Set((day(k).food || []).map((e) => e.preset));
  const list = S.presets.filter((p) => !used.has(p.id));
  return list.length ? `<div class="presets">${list.map((p) => `<button class="chip" data-preset="${esc(p.id)}">⚡ ${esc(p.name)} <small>${p.kcal}</small></button>`).join('')}</div>` : '';
}
function logPreset(id) {
  const p = S.presets.find((x) => x.id === id); if (!p) return;
  const k = selected;
  if (dlg().open) dlg().close();
  update(k, { food: [...(day(k).food || []), { id: String(Date.now()) + Math.floor(Math.random() * 1e3), meal: p.meal, name: p.name, qty: 1, basis: 'unit',
    kcal: p.kcal, p: p.p, f: p.f, c: p.c, est: true, preset: p.id }] });
  toast(`⚡ ${p.name}: +${p.kcal} kcal`);
}
function renderQPresets() {
  $('qPresets').innerHTML = S.presets.length ? S.presets.map((p) => `<span class="pchip"><button type="button" class="chip" data-preset="${esc(p.id)}">⚡ ${esc(p.name)} <small>${p.kcal} kcal</small></button><button type="button" class="x" data-delpreset="${esc(p.id)}" aria-label="Delete preset">×</button></span>`).join('') : '';
}
function renderFoodMini() {
  const k = selected, t = foodTotals(k), g = S.goals.kcal;
  $('foodMini').innerHTML = `
    <div class="card-head"><h2>\u{1F37D}️ Fuel</h2><button class="dayjump" data-view="food">Details</button></div>
    <div class="fuel-row"><b>${t.kcal}</b><span class="tiny">/ ${g} kcal</span><span class="tiny" style="margin-left:auto">P ${t.p}g · F ${t.f}g · C ${t.c}g</span></div>
    <div class="bar"><i style="width:${Math.min(100, t.kcal / g * 100)}%;background:${calBarColor(k)}"></i></div>
    <p class="tiny" style="margin:8px 0 14px">${esc(foodMsg(k))}</p>
    ${presetChips(k)}
    <div class="data-row"><button class="btn" data-addfood="scan">\u{1F4F7} Scan</button><button class="btn ghost" data-addfood="quick">Quick add</button></div>`;
}
function renderFood() {
  const k = selected, t = foodTotals(k), g = S.goals, entries = day(k).food || [], isToday = k === TODAY();
  const left = g.kcal - t.kcal;
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m); if (!list.length) return '';
    const sum = list.reduce((s, e) => s + e.kcal, 0);
    return `<div class="meal"><div class="meal-head"><h3>${m}</h3><span class="tiny">${Math.round(sum)} kcal</span></div>
      ${list.map((e) => `<div class="entry"><div><b>${esc(e.name)}</b><span class="tiny">${e.est ? `estimate${e.p ? ` · P ${r1(e.p)}` : ''}` : `${r1(e.qty)}${e.basis === 'unit' ? ' serving' + (e.qty === 1 ? '' : 's') : ' g'} · P ${r1(e.p)} F ${r1(e.f)} C ${r1(e.c)}`}</span></div>
        <span class="kc">${e.est ? '~' : ''}${e.kcal}</span><button class="x" data-delfood="${e.id}" aria-label="Remove">×</button></div>`).join('')}</div>`;
  }).join('');
  $('foodSummary').innerHTML = `
    <div class="card-head"><h2>${isToday ? 'Food today' : fmtLong(k)}</h2>${isToday ? '' : '<button class="dayjump" data-today>Back to today</button>'}</div>
    <div class="rings two">
      ${ring('Calories', t.kcal, g.kcal, calBarColor(k), `${Math.abs(left)}`, left >= 0 ? 'kcal left' : 'kcal over')}
      ${ring('Protein', t.p, g.protein, 'var(--grape)', `${Math.round(t.p)}`, `of ${g.protein} g`)}
    </div>
    <div class="macros"><span style="--c:var(--grape)"><i class="dot"></i>Protein <b>${t.p} g</b></span><span style="--c:var(--sun)"><i class="dot"></i>Fat <b>${t.f} g</b></span><span style="--c:var(--sky)"><i class="dot"></i>Carbs <b>${t.c} g</b></span></div>
    <p class="foodmsg">${esc(foodMsg(k))}</p>
    ${presetChips(k)}
    <div class="data-row"><button class="btn" data-addfood="scan">\u{1F4F7} Scan barcode</button><button class="btn ghost" data-addfood="quick">Quick add</button><button class="btn ghost" data-addfood="saved">Saved foods</button><button class="btn ghost" data-addfood="manual">By hand</button></div>`;
  $('foodMeals').innerHTML = `<div class="card-head"><h2>Meals</h2><span class="tiny">${entries.length} item${entries.length === 1 ? '' : 's'}</span></div>
    ${meals || '<p class="empty">Nothing here yet. Scan a barcode or add something by hand.</p>'}`;
}

/* ---- add-food dialog ---- */
const PANES = ['scan', 'saved', 'quick', 'manual'];
let draft = null, ftab = 'scan', pendingCode = '', scanStop = null, qMeal = 'Lunch';
// Quick add: a rough estimate for meals with no barcode (canteen, restaurant). Remembers your last one per meal.
function setQuickMeal(m) {
  qMeal = m;
  $('qMeals').innerHTML = MEALS.map((x) => `<button type="button" class="chip ${x === m ? 'on' : ''}" data-qmeal="${x}">${x}</button>`).join('');
  const last = S.quick[m];
  $('qName').value = last ? last.name : m === 'Lunch' ? 'Canteen lunch' : 'Eating out';
  $('qKcal').value = last ? last.kcal : '';
  $('qP').value = last && last.p ? last.p : '';
  $('qLast').textContent = last ? `Pre-filled from last time. Change it if today was different.` : 'Rough is fine. A steady estimate beats a missing meal.';
}
const dlg = () => $('foodDlg');
function openFood(tab) { draft = null; pendingCode = ''; if (!dlg().open) dlg().showModal(); setFtab(tab || 'scan'); }
function setFtab(t) {
  ftab = t; stopScan(); draft = null;
  $('dtabs').hidden = false; $('pickPane').hidden = true;
  for (const p of PANES) $(p + 'Pane').hidden = p !== t;
  document.querySelectorAll('#dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.ftab === t));
  if (t === 'scan') { $('scanMsg').textContent = ''; startScan(); }
  if (t === 'saved') renderSaved();
  if (t === 'quick') { $('quickForm').reset(); renderQPresets(); setQuickMeal(defaultMeal()); }
  if (t === 'manual') $('manualForm').reset();
}
function stopScan() { if (scanStop) { try { scanStop(); } catch {} scanStop = null; } }
async function startScan() {
  const msg = $('scanMsg'), video = $('scanVideo');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'Camera needs a secure (https) page. Type the number below instead.'; return; }
  msg.textContent = 'Starting camera…';
  try {
    if ('BarcodeDetector' in window) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; await video.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      let live = true;
      scanStop = () => { live = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
      const loop = async () => {
        if (!live) return;
        try { const c = await det.detect(video); if (c[0]) return onCode(c[0].rawValue); } catch {}
        setTimeout(loop, 250);
      };
      loop();
    } else {
      const { BrowserMultiFormatReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
      const reader = new BrowserMultiFormatReader();
      scanStop = () => reader.reset();
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (res) => { if (res) onCode(res.getText()); });
    }
    msg.textContent = 'Point the camera at a barcode';
  } catch (e) {
    msg.textContent = e && e.name === 'NotAllowedError' ? 'Camera permission is blocked. Type the number below instead.' : 'Couldn’t start the camera. Type the number below instead.';
  }
}
function onCode(code) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); lookup(code); }
async function lookup(code) {
  code = String(code).replace(/\D/g, '');
  if (code.length < 6) { $('scanMsg').textContent = 'That doesn’t look like a barcode number.'; return; }
  const known = S.foods.find((f) => f.id === code);
  if (known) return openPick(known);
  $('scanMsg').textContent = 'Looking it up…';
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
    const j = await res.json(), p = j.status === 1 && j.product, n = (p && p.nutriments) || {};
    const kcal = n['energy-kcal_100g'] != null ? n['energy-kcal_100g'] : n.energy_100g != null ? n.energy_100g / 4.184 : null;
    if (!p || kcal == null) throw 0;
    openPick({ id: code, barcode: code, name: p.product_name || 'Unknown product', brand: (p.brands || '').split(',')[0], basis: 'g',
      kcal: r1(kcal), p: r1(n.proteins_100g), f: r1(n.fat_100g), c: r1(n.carbohydrates_100g), serving: Math.round(+p.serving_quantity) || 0 });
  } catch {
    pendingCode = code; setFtab('manual');
    toast('Not in the database. Add it by hand once and it’s saved.');
  }
}
function renderSaved() {
  const q = $('savedQ').value.trim().toLowerCase();
  const list = S.foods.filter((f) => !q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q));
  $('savedList').innerHTML = list.length ? list.map((f) => `<button class="saved" data-pickfood="${esc(f.id)}"><b>${esc(f.name)}</b>
      <span class="tiny">${f.brand ? esc(f.brand) + ' · ' : ''}${f.kcal} kcal ${f.basis === 'unit' ? 'per serving' : 'per 100 g'}</span></button>`).join('')
    : `<p class="empty">${S.foods.length ? 'No match.' : 'Foods you log show up here for one-tap reuse.'}</p>`;
}
function openPick(food, qty) {
  stopScan();
  draft = { food, qty: qty || (food.basis === 'unit' ? 1 : food.serving || 100), meal: defaultMeal() };
  if (!dlg().open) dlg().showModal();
  for (const p of PANES) $(p + 'Pane').hidden = true;
  $('dtabs').hidden = true; $('pickPane').hidden = false;
  const f = food, unit = f.basis === 'unit';
  const quick = unit ? [0.5, 1, 2] : [...new Set([f.serving, 50, 100, 150, 200].filter(Boolean))].sort((a, b) => a - b);
  $('pickBody').innerHTML = `
    <h3>${esc(f.name)}</h3>${f.brand ? `<p class="tiny">${esc(f.brand)}</p>` : ''}
    <p class="tiny">${unit ? 'Per 1 serving' : 'Per 100 g'}: ${f.kcal} kcal · P ${f.p} · F ${f.f} · C ${f.c}</p>
    <label class="qty">Amount <input type="number" id="qty" min="0" step="any" inputmode="decimal" value="${draft.qty}"><span>${unit ? 'servings' : 'grams'}</span></label>
    <div class="sub">${quick.map((v) => `<button type="button" class="chip" data-qty="${v}">${v}${unit ? '×' : ' g'}${v === f.serving ? ' (serving)' : ''}</button>`).join('')}</div>
    <div id="pickPrev" class="pick-prev"></div>
    <div class="sub meals">${MEALS.map((m) => `<button type="button" class="chip ${m === draft.meal ? 'on' : ''}" data-meal="${m}">${m}</button>`).join('')}</div>
    <div class="data-row"><button type="button" class="btn" data-pickadd>Add to log</button><button type="button" class="btn ghost" data-pickback>Back</button></div>`;
  updatePrev();
}
function entryFor(f, qty, meal) {
  const x = f.basis === 'unit' ? qty : qty / 100;
  return { id: String(Date.now()) + Math.floor(Math.random() * 1e3), meal, name: f.name, qty, basis: f.basis,
    kcal: Math.round(f.kcal * x), p: r1(f.p * x), f: r1(f.f * x), c: r1(f.c * x) };
}
function updatePrev() {
  if (!draft) return;
  const q = parseFloat($('qty').value), ok = q > 0, e = ok ? entryFor(draft.food, q, draft.meal) : null;
  draft.qty = ok ? q : draft.qty;
  $('pickPrev').innerHTML = ok ? `<b>${e.kcal}</b> kcal <span class="tiny">P ${e.p} g · F ${e.f} g · C ${e.c} g</span>` : '<span class="tiny">Enter an amount</span>';
  document.querySelector('[data-pickadd]').disabled = !ok;
}
function addDraft() {
  const q = parseFloat($('qty').value); if (!(q > 0) || !draft) return;
  const f = draft.food, e = entryFor(f, q, draft.meal);
  S.foods = [f, ...S.foods.filter((x) => x.id !== f.id)].slice(0, 150);
  const k = selected;
  dlg().close();
  update(k, { food: [...(day(k).food || []), e] });
  toast(`\u{1F37D}️ +${e.kcal} kcal logged`);
}

function renderNextReward() {
  const L = levelInfo(totalXp()), r = nextReward(), ready = sortedRewards().filter((x) => !x.claimed && x.level <= L.lvl);
  let body;
  if (ready.length) body = `<p class="reward-line"><span class="emo">\u{1F381}</span> <b>${ready.length}</b> reward${ready.length > 1 ? 's' : ''} waiting for you!</p><button class="btn" data-view="rewards">Go claim</button>`;
  else if (r) {
    const have = totalXp(), from = xpToReach(Math.max(1, r.level - 1)), need = xpToReach(r.level);
    const pct = clamp((have - from) / Math.max(1, need - from) * 100, 0, 100);
    body = `<p class="reward-line"><span class="emo">${esc(r.emo)}</span> ${esc(r.text)}</p>
      <div class="bar"><i style="width:${pct}%"></i></div><p class="tiny">Level ${r.level} · ${need - have} xp to go</p>`;
  } else body = '<p class="empty">No upcoming rewards. Add one to chase.</p>';
  $('rewardCard').innerHTML = `<div class="card-head"><h2>\u{1F381} Next reward</h2><button class="dayjump" data-view="rewards">All</button></div>${body}`;
}
function renderRewards() {
  const L = levelInfo(totalXp()), xp = totalXp();
  const card = (r) => {
    const open = r.level <= L.lvl, state = r.claimed ? 'claimed' : open ? 'ready' : 'locked';
    const foot = r.claimed ? `<p class="tiny">Enjoyed ${parse(r.claimed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>`
      : open ? `<button class="btn" data-claim="${r.id}">Claim it!</button>`
      : `<p class="tiny">${xpToReach(r.level) - xp} xp to go</p>`;
    return `<div class="reward ${state}"><button class="x" data-delreward="${r.id}" aria-label="Delete reward">×</button>
      <span class="lvl">Lv ${r.level}</span><span class="big">${esc(r.emo)}</span><h3>${esc(r.text)}</h3>${foot}</div>`;
  };
  const list = sortedRewards();
  $('rewardsCard').innerHTML = `
    <div class="card-head"><h2>Rewards</h2><span class="tiny">You’re level ${L.lvl}</span></div>
    <p class="empty" style="margin-bottom:14px">Treats you set for yourself. Reach the level, then tap claim once you’ve actually enjoyed it (or moved the money).</p>
    <form class="add" id="addReward"><input type="text" id="rwEmo" class="emo-in" value="\u{1F381}" maxlength="4" aria-label="Emoji">
      <input type="text" id="rwText" placeholder="€50 to savings, new headphones…" maxlength="80" required aria-label="Reward">
      <input type="number" id="rwLevel" min="2" max="99" value="${L.lvl + 1}" style="width:84px" aria-label="Level">
      <button class="btn">Add</button></form>
    ${list.length ? `<div class="rewards">${list.map(card).join('')}</div>` : '<p class="empty">Nothing here yet. What would make leveling up worth it?</p>'}`;
}
function renderBadges() {
  const got = BADGES.filter((b) => S.badges[b.id]).length;
  $('badgeCard').innerHTML = `
    <div class="card-head"><h2>Badges</h2><span class="tiny">${got} of ${BADGES.length} unlocked</span></div>
    <div class="badges">${BADGES.map((b) => {
      const on = S.badges[b.id];
      return `<div class="badge ${on ? '' : 'locked'}" style="--c:${b.c}"><span class="big">${b.emo}</span><h3>${b.name}</h3><p>${on ? `Earned ${parse(on).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : b.desc}</p></div>`;
    }).join('')}</div>`;
}
function renderGoals() {
  const g = S.goals;
  const f = (id, label, hint, val, step = 1) => `<div class="field"><label for="${id}">${label}<span class="tiny">${hint}</span></label>
    <input type="number" id="${id}" data-goal-field="${id}" value="${val}" min="0" step="${step}"></div>`;
  $('targetsCard').innerHTML = `
    <div class="card-head"><h2>Targets</h2><span class="tiny">Quests, rings and xp follow these</span></div>
    <div class="field"><label for="name">Your name<span class="tiny">For the greeting</span></label><input type="text" id="name" value="${esc(S.name)}" style="width:140px"></div>
    ${f('gymPerWeek', 'Gym sessions per week', 'Streak counts weeks you hit this', g.gymPerWeek)}
    ${f('eatDaysPerWeek', 'Good eating days per week', 'Days rated Okay or Great', g.eatDaysPerWeek)}
    ${f('workPerDay', 'Work hours per day', 'Weekly target is five days of this', g.workPerDay, 0.5)}
    ${f('water', 'Glasses of water per day', '', g.water)}
    ${f('sleep', 'Hours of sleep', '', g.sleep, 0.5)}
    ${f('kcal', 'Daily calories', 'Your eating quest completes near this number', g.kcal, 50)}
    ${f('protein', 'Daily protein (g)', 'Helps keep muscle while cutting', g.protein, 5)}`;
  const p = S.profile, c = calc();
  const sel = (id, opts, val) => `<select id="${id}" data-prof="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const num = (id, label, val, ph) => `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" data-prof="${id}" value="${val}" placeholder="${ph}" min="0" step="any"></div>`;
  $('calcCard').innerHTML = `
    <div class="card-head"><h2>Calorie calculator</h2><span class="tiny">An estimate, not medical advice</span></div>
    <div class="field"><label for="sex">Sex<span class="tiny">For the formula</span></label>${sel('sex', [['m', 'Male'], ['f', 'Female']], p.sex)}</div>
    ${num('age', 'Age', p.age, 'years')}${num('height', 'Height (cm)', p.height, 'cm')}${num('weight', 'Weight (kg)', p.weight, 'kg')}
    <div class="field"><label for="activity">Activity</label>${sel('activity', [[1.2, 'Mostly sitting'], [1.375, 'Light (1–3 workouts/wk)'], [1.55, 'Moderate (3–5/wk)'], [1.725, 'Very active (6+/wk)']], p.activity)}</div>
    <div class="field"><label for="pace">Pace<span class="tiny">Slow and steady keeps the muscle</span></label>${sel('pace', [[0, 'Maintain'], [0.25, 'Gentle: 0.25 kg/wk'], [0.5, 'Steady: 0.5 kg/wk']], p.pace)}</div>
    ${c ? `<div class="calc-out"><div><span class="tiny">Maintenance</span><b>${c.tdee}</b><span class="tiny">kcal/day</span></div>
      <div><span class="tiny">Your target</span><b>${c.target}</b><span class="tiny">kcal/day</span></div>
      <div><span class="tiny">Protein</span><b>${c.protein}</b><span class="tiny">g/day</span></div></div>
      ${c.floored ? `<p class="tiny">Raised to ${c.floor} kcal, a sensible minimum. Going lower isn’t worth it.</p>` : ''}
      <button class="btn" data-usecalc style="margin-top:12px">Use these targets</button>`
      : '<p class="empty">Fill in age, height and weight to get a daily target.</p>'}`;
  $('customCard').innerHTML = `
    <div class="card-head"><h2>Personal goals</h2><span class="tiny">+50 xp each</span></div>
    <form class="add" id="addGoal"><input type="text" id="goalText" placeholder="Run 5k without stopping…" maxlength="120" required aria-label="Goal">
      <input type="date" id="goalDue" aria-label="Optional due date"><button class="btn">Add</button></form>
    ${S.custom.length ? S.custom.map(goalRow).join('') : '<p class="empty">Goals you set will live here.</p>'}`;
  $('dataCard').innerHTML = `
    <div class="card-head"><h2>Your data</h2><span class="tiny">${cloud && cloud.user ? `Signed in as ${esc(cloud.user.email)}` : 'Stored on this device'}</span></div>
    <div class="data-row"><button class="btn ghost" id="export">Export backup</button>
    <label class="btn ghost" style="cursor:pointer">Import backup<input type="file" id="import" accept="application/json" hidden></label>
    ${cloud && cloud.user ? '<button class="btn ghost" id="signOut">Sign out</button>' : ''}</div>`;
}

const VIEWS = ['home', 'food', 'badges', 'rewards', 'goals'];
const view = () => VIEWS.find((v) => !$(v).hidden);
function render() {
  renderHeader();
  const v = view();
  if (v === 'home') { renderDay(); renderFoodMini(); renderWeek(); renderCal(); renderNextReward(); renderFocus(); }
  else if (v === 'food') renderFood();
  else if (v === 'badges') renderBadges();
  else if (v === 'rewards') renderRewards();
  else renderGoals();
}

/* ---------- events ---------- */
document.addEventListener('pointerdown', (e) => { lastPt = { x: e.clientX, y: e.clientY }; }, true);
document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const ds = t.dataset;
  if (ds.view) return showView(ds.view);
  if (ds.day) { selected = ds.day; return render(); }
  if (ds.today !== undefined) { selected = TODAY(); cursor = startOfMonth(new Date()); return render(); }
  if (ds.cal) { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + +ds.cal, 1); return renderCal(); }
  if (ds.toggle) { const on = !day(selected).gym; return update(selected, { gym: on, rest: false, gymType: on ? day(selected).gymType : undefined }); }
  if (ds.rest !== undefined) return update(selected, { rest: !day(selected).rest });
  if (ds.gymtype) return update(selected, { gymType: day(selected).gymType === ds.gymtype ? undefined : ds.gymtype });
  if (ds.eat) return update(selected, { eat: day(selected).eat === +ds.eat ? 0 : +ds.eat });
  if (ds.step) {
    const step = ds.step === 'water' ? 1 : 0.5, max = ds.step === 'water' ? 30 : 24;
    return update(selected, { [ds.step]: clamp((day(selected)[ds.step] || 0) + step * +ds.by, 0, max) });
  }
  if (ds.goal) {
    const c = S.custom.find((x) => x.id === ds.goal); c.done = !c.done;
    if (c.done) { toast('\u{1F3AF} Goal done! +50 xp'); burst(70); }
    syncBadges(false); save(); return render();
  }
  if (ds.addfood) return openFood(ds.addfood);
  if (ds.ftab) return setFtab(ds.ftab);
  if (ds.qmeal) return setQuickMeal(ds.qmeal);
  if (ds.preset) return logPreset(ds.preset);
  if (ds.delpreset) { S.presets = S.presets.filter((p) => p.id !== ds.delpreset); save(); return renderQPresets(); }
  if (ds.closedlg !== undefined) return dlg().close();
  if (ds.pickfood) return openPick(S.foods.find((f) => f.id === ds.pickfood));
  if (ds.qty) { $('qty').value = ds.qty; return updatePrev(); }
  if (ds.meal) { draft.meal = ds.meal; document.querySelectorAll('[data-meal]').forEach((b) => b.classList.toggle('on', b === t)); return updatePrev(); }
  if (ds.pickback !== undefined) return setFtab(ftab);
  if (ds.pickadd !== undefined) return addDraft();
  if (ds.delfood) { const k = selected; return update(k, { food: (day(k).food || []).filter((e) => e.id !== ds.delfood) }); }
  if (ds.usecalc !== undefined) { const c = calc(); S.goals.kcal = c.target; S.goals.protein = c.protein; save(); toast('Targets updated'); return render(); }
  if (ds.claim) {
    const r = S.rewards.find((x) => x.id === ds.claim); r.claimed = TODAY();
    toast(`${r.emo} Enjoy it, you earned it!`); burst(140); save(); return render();
  }
  if (ds.delreward) { S.rewards = S.rewards.filter((x) => x.id !== ds.delreward); save(); return render(); }
  if (ds.del) { S.custom = S.custom.filter((x) => x.id !== ds.del); save(); return render(); }
  if (t.id === 'buddy') {
    t.classList.remove('bounce'); void t.offsetWidth; t.classList.add('bounce');
    return toast(NUDGES[Math.floor(Math.random() * NUDGES.length)]);
  }
  if (t.id === 'signOut') return cloud.signOut();
  if (t.id === 'export') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `steady-backup-${TODAY()}.json`; a.click();
  }
});
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
function showView(v) {
  for (const id of VIEWS) $(id).hidden = id !== v;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  render(); scrollTo(0, 0);
}
dlg().addEventListener('close', stopScan);
dlg().addEventListener('click', (e) => { if (e.target === dlg()) dlg().close(); }); // tap the backdrop to close
document.addEventListener('input', (e) => {
  if (e.target.id === 'qty') updatePrev();
  else if (e.target.id === 'savedQ') renderSaved();
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'codeForm') { e.preventDefault(); const v = $('codeIn').value; $('codeIn').value = ''; return lookup(v); }
  if (e.target.id === 'quickForm') {
    e.preventDefault();
    const kcal = Math.round(+$('qKcal').value), p = r1($('qP').value), name = $('qName').value.trim() || 'Eating out';
    if (!(kcal > 0)) return;
    S.quick[qMeal] = { name, kcal, p };
    const k = selected, pid = $('qSave').checked ? 'p-' + Date.now() : undefined;
    if (pid) S.presets.push({ id: pid, meal: qMeal, name, kcal, p, f: 0, c: 0 });
    dlg().close();
    update(k, { food: [...(day(k).food || []), { id: String(Date.now()) + Math.floor(Math.random() * 1e3), meal: qMeal, name, qty: 1, basis: 'unit', kcal, p, f: 0, c: 0, est: true, ...(pid && { preset: pid }) }] });
    return toast(`\u{1F37D}️ +${kcal} kcal logged (estimate)`);
  }
  if (e.target.id === 'manualForm') {
    e.preventDefault();
    const v = (id) => $(id).value, name = v('mfName').trim(); if (!name) return;
    const basis = v('mfBasis'), id = pendingCode || `m-${name.toLowerCase().replace(/\W+/g, '-')}-${basis}`;
    const food = { id, name, brand: '', basis, kcal: r1(v('mfKcal')), p: r1(v('mfP')), f: r1(v('mfF')), c: r1(v('mfC')), serving: 0 };
    if (pendingCode) food.barcode = pendingCode;
    pendingCode = '';
    return openPick(food);
  }
  if (e.target.id === 'addReward') {
    e.preventDefault();
    const text = $('rwText').value.trim(), level = Math.round(+$('rwLevel').value);
    if (!text || !(level >= 2)) return;
    S.rewards.push({ id: String(Date.now()), level, emo: $('rwEmo').value.trim() || '\u{1F381}', text, claimed: '' });
    save(); return render();
  }
  if (e.target.id !== 'addGoal') return;
  e.preventDefault();
  const text = $('goalText').value.trim(); if (!text) return;
  S.custom.unshift({ id: String(Date.now()), text, due: $('goalDue').value || '', done: false });
  save(); render();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.prof) { S.profile[t.dataset.prof] = t.type === 'number' || t.tagName === 'SELECT' && t.id !== 'sex' ? (t.value === '' ? '' : +t.value) : t.value; save(); renderGoals(); return; }
  if (t.dataset.goalField) {
    const v = parseFloat(t.value);
    if (!isNaN(v) && v >= 0) { S.goals[t.dataset.goalField] = v; save(); renderHeader(); }
  } else if (t.id === 'name') { S.name = t.value.trim(); save(); renderHeader(); }
  else if (t.id === 'import' && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { const d = JSON.parse(txt); if (!d.goals || !d.days) throw 0; S = norm(d); syncBadges(true); save(); render(); toast('Backup imported'); }
      catch { toast('That file doesn’t look like a backup'); }
    });
  }
});

load();
