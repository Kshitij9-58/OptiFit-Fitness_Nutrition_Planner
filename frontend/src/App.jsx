import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AuthPage from './AuthPage.jsx';
import { useApiFetch, useAuth } from './lib/auth.jsx';

const API = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

/* ------------------------------------------------------------- constants */

// Values must match the Literal types in schemas.py exactly.
const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];
const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Desk job, little exercise' },
  { value: 'lightly active', label: 'Lightly active', hint: 'Light exercise 1 to 3 days a week' },
  { value: 'active', label: 'Active', hint: 'Training 3 to 5 days a week' },
  { value: 'very active', label: 'Very active', hint: 'Training 6 to 7 days a week' },
];
const GOALS = [
  { value: 'weight loss', label: 'Lose fat' },
  { value: 'muscle gain', label: 'Build muscle' },
  { value: 'maintenance', label: 'Maintain' },
];
const DIETS = [
  { value: 'non-vegetarian', label: 'No restriction' },
  { value: 'vegetarian', label: 'Vegetarian' },
];

const FIELD_LABELS = {
  age: 'Age', height: 'Height', weight: 'Weight', gender: 'Gender',
  activity_level: 'Activity level', fitness_goal: 'Goal', diet_type: 'Diet',
};

const MEAL_SHARE = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snacks: 0.10 };

const MACROS = [
  { key: 'protein_g', label: 'Protein', kcalPerG: 4, color: '#FF5A1F' },
  { key: 'carbs_g', label: 'Carbs', kcalPerG: 4, color: '#2F6F5E' },
  { key: 'fats_g', label: 'Fat', kcalPerG: 9, color: '#C9BFA8' },
];

// Short, attributed, and old enough to be freely quotable.
const QUOTES = [
  { text: 'Let food be thy medicine and medicine be thy food.', who: 'Hippocrates' },
  { text: 'No man has the right to be an amateur in physical training.', who: 'Socrates' },
  { text: 'The groundwork of all happiness is health.', who: 'Leigh Hunt' },
  { text: 'A sound mind in a sound body is a thing to be prayed for.', who: 'Juvenal' },
];

// Showing the working is what separates a calculator you trust from one you
// do not. Each answer names the actual method rather than gesturing at it.
const METHOD = [
  {
    q: 'Where does the calorie number come from?',
    a: 'Your resting burn is estimated with the Mifflin-St Jeor equation, which uses weight, height, age and sex. That gets multiplied by an activity factor between 1.2 and 1.725 to give the calories you burn on a normal day, then adjusted for your goal: roughly 500 below for fat loss, 300 above for muscle.',
  },
  {
    q: 'Why is protein set where it is?',
    a: 'Between 1.8 and 2.2 grams per kilogram of bodyweight, highest in a deficit. Protein is the macro that protects lean mass when calories are low, so it goes up rather than down when you are cutting. Fat is held near 25 percent of calories and carbohydrate takes the remainder.',
  },
  {
    q: 'How accurate is this?',
    a: 'Equations estimate a population average, so your real burn can sit 10 to 15 percent either side of it. Treat the number as a starting point: hold it for two or three weeks, track your weight, and adjust if nothing moves. No calculator can measure your metabolism.',
  },
  {
    q: 'Is the training week personalised?',
    a: 'It is matched to your goal and your training frequency, but it is a template rather than individual programming. A coach watching you lift would write something different. Use it as a structure to work from.',
  },
];

const STEPS = [
  { n: '01', title: 'Enter your measurements', body: 'Age, height, weight, how often you train, and what you are aiming for.' },
  { n: '02', title: 'Get your numbers', body: 'Resting burn, daily calories, and a macro split calculated from your own body.' },
  { n: '03', title: 'Train the week', body: 'Seven days of sessions matched to your goal, with meals sized to the target.' },
];

const LBS_PER_KG = 2.20462;
const CM_PER_IN = 2.54;

/* --------------------------------------------------------------- helpers */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up to a value once. The single piece of motion on a real plan. */
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(target);
  const frame = useRef();

  useEffect(() => {
    if (typeof target !== 'number' || prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);

  return value;
}

/* ------------------------------------------------------------ primitives */

function Mark({ className = '' }) {
  // Three stacked bars, echoing the macro split the product is built on.
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="2" y="5" width="24" height="5" rx="2.5" fill="#FF5A1F" />
      <rect x="2" y="12" width="17" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="2" y="19" width="10" height="5" rx="2.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Heart trace drawing itself across the hero, behind the content. */
function PulseLine({ className = '' }) {
  return (
    <svg className={`ecg ${className}`} viewBox="0 0 1200 160" fill="none"
      preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 80 H180 l18 -44 l16 88 l18 -66 l14 22 H420 l20 -52 l16 104 l18 -78 l14 26 H760
           l18 -44 l16 88 l18 -66 l14 22 H1200"
        stroke="#FF5A1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A sample readout in the hero, so the first screen shows the output. */
function HeroSpecimen() {
  const kcal = useCountUp(2480, 1400);
  const bars = [
    { label: 'Protein', g: 154, pct: 25, color: '#FF5A1F' },
    { label: 'Carbs', g: 279, pct: 45, color: '#2F6F5E' },
    { label: 'Fat', g: 83, pct: 30, color: '#C9BFA8' },
  ];
  return (
    <div className="float w-full max-w-[320px] bg-white rounded-2xl border border-black/5
                    shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] p-6" aria-hidden="true">
      <p className="text-[10px] font-bold text-[#6E756F] mb-3">Sample plan</p>
      <div className="flex items-end gap-2">
        <span className="figure text-[46px] leading-[0.8] text-[#141815]">{kcal}</span>
        <span className="text-[12px] text-[#6E756F] pb-1.5 font-semibold">kcal / day</span>
      </div>

      <div className="mt-6 space-y-3">
        {bars.map((b, i) => (
          <div key={b.label}>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="font-bold text-[#6E756F]">{b.label}</span>
              <span className="tnum text-[#9DA29E]">{b.g}g</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#EDEBE5] overflow-hidden">
              <div className="h-full rounded-full grow-bar"
                style={{ width: `${b.pct * 2}%`, background: b.color,
                         animationDelay: `${300 + i * 130}ms` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-[#EDEBE5] space-y-2">
        {[['Mon', 'Heavy push'], ['Tue', 'Intervals'], ['Wed', 'Mobility']].map(([d, s]) => (
          <div key={d} className="flex gap-3 text-[11px]">
            <span className="font-extrabold text-[#FF5A1F] w-8">{d}</span>
            <span className="text-[#6E756F]">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Twelve-week weight trajectory from the daily calorie gap.
 * Roughly 7700 kcal per kilogram of bodyweight. Deliberately linear, with the
 * caveat stated underneath, because real rates slow as bodyweight falls.
 */
function ProjectionChart({ startKg, tdee, target, units }) {
  const WEEKS = 12;
  const weeklyKg = ((target - tdee) * 7) / 7700;
  const points = Array.from({ length: WEEKS + 1 }, (_, w) => startKg + weeklyKg * w);
  const endKg = points[WEEKS];
  const toDisplay = (kg) => (units === 'metric' ? kg : kg * LBS_PER_KG);
  const unitLabel = units === 'metric' ? 'kg' : 'lb';

  const W = 560, H = 150, PAD = 6;
  const min = Math.min(...points), max = Math.max(...points);
  const span = Math.max(max - min, 1); // a flat line still needs a sane scale
  const x = (i) => PAD + (i / WEEKS) * (W - PAD * 2);
  const y = (kg) => PAD + (1 - (kg - min) / span) * (H - PAD * 2);
  const path = points.map((kg, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(kg).toFixed(1)}`).join(' ');
  const area = `${path} L${x(WEEKS).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const changed = Math.abs(endKg - startKg) >= 0.1;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
        <h2 className="text-[15px] font-extrabold">If you hold this for 12 weeks</h2>
        <p className="text-[12px] text-[#6E756F] tnum">
          {toDisplay(startKg).toFixed(1)} {unitLabel}
          <span className="mx-2 text-[#C9BFA8]">&rarr;</span>
          <span className="font-bold text-[#141815]">
            {toDisplay(endKg).toFixed(1)} {unitLabel}
          </span>
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]" role="img"
        aria-label={`Projected change from ${toDisplay(startKg).toFixed(1)} to ${toDisplay(endKg).toFixed(1)} ${unitLabel} over twelve weeks`}>
        <defs>
          <linearGradient id="proj" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF5A1F" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#FF5A1F" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 4, 8, 12].map((w) => (
          <line key={w} x1={x(w)} y1={PAD} x2={x(w)} y2={H - PAD}
            stroke="#E3E1DA" strokeWidth="1" />
        ))}
        {changed && <path d={area} fill="url(#proj)" />}
        <path d={path} className="draw-line" fill="none" stroke="#FF5A1F"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(WEEKS)} cy={y(endKg)} r="4.5" fill="#FF5A1F" />
      </svg>

      <div className="flex justify-between text-[11px] text-[#9DA29E] font-semibold mt-1">
        {[0, 4, 8, 12].map((w) => <span key={w}>{w ? `Week ${w}` : 'Now'}</span>)}
      </div>

      <p className="text-[11px] text-[#6E756F] leading-relaxed mt-4">
        {changed
          ? `About ${Math.abs(weeklyKg * (units === 'metric' ? 1 : LBS_PER_KG)).toFixed(2)} ${unitLabel} a week at this calorie gap. Real progress is rarely this straight: rates slow as bodyweight changes, and water shifts hide it week to week.`
          : 'Your target matches your daily burn, so weight should stay roughly where it is. That is the point of maintenance.'}
      </p>
    </div>
  );
}

/**
 * Tick off sessions as you do them. Kept in this browser only, per plan, so it
 * works without accounts; clearing site data clears it.
 */
/**
 * Session ticks. Written to the server when the plan belongs to an account, so
 * progress follows the person between devices; localStorage is the fallback
 * for anonymous plans, where there is nowhere else to put it.
 */
function useWeekProgress(profileId, serverDays, signedIn, apiFetch) {
  const storageKey = `optifit:week:${profileId ?? 'local'}`;
  const [done, setDone] = useState({});

  useEffect(() => {
    if (signedIn && serverDays !== undefined) {
      try { setDone(serverDays ? JSON.parse(serverDays) : {}); }
      catch { setDone({}); }
      return;
    }
    try { setDone(JSON.parse(localStorage.getItem(storageKey) ?? '{}')); }
    catch { setDone({}); }
  }, [storageKey, serverDays, signedIn]);

  const persist = useCallback(async (next) => {
    if (signedIn && profileId) {
      try {
        await apiFetch(`${API}/api/profile/${profileId}/progress`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed_days: next }),
        });
        return;
      } catch { /* fall through to local storage so a tick is never lost */ }
    }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  }, [signedIn, profileId, storageKey, apiFetch]);

  return {
    done,
    toggle: (day) => setDone((d) => {
      const next = { ...d, [day]: !d[day] };
      persist(next);           // optimistic: the tick shows instantly
      return next;
    }),
    reset: () => { setDone({}); persist({}); },
  };
}

function WeekTracker({ days, done, onReset }) {
  const count = days.filter((d) => done[d]).length;
  const pct = days.length ? count / days.length : 0;
  const R = 15, C = 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={R} fill="none" stroke="#FF5A1F" strokeWidth="3.5"
          strokeLinecap="round" strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 420ms cubic-bezier(0.22,1,0.36,1)' }} />
      </svg>
      <div>
        <p className="text-[13px] font-extrabold tnum">{count} of {days.length} done</p>
        <p className="text-[11px] text-[#A9B5AE]">
          {count === days.length ? 'Full week. Well done.' : 'Tick each session as you finish it.'}
        </p>
      </div>
      <button onClick={onReset}
        className="ml-auto text-[11px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] transition-colors">
        Reset
      </button>
    </div>
  );
}

/** Signed-in state in the header: who you are, and the way out. */
function AccountMenu({ user, onSignIn, onSignOut, loading }) {
  const [open, setOpen] = useState(false);
  if (loading) return <span className="w-20 h-6" aria-hidden="true" />;

  if (!user) {
    return (
      <button onClick={onSignIn}
        className="text-[12px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] transition-colors">
        Sign in
      </button>
    );
  }

  const initial = (user.email ?? '?').charAt(0).toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex items-center gap-2 text-[12px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] transition-colors">
        <span className="w-6 h-6 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center text-[11px] font-extrabold">
          {initial}
        </span>
        <span className="hidden sm:inline max-w-[160px] truncate">{user.email}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-[#E3E1DA] shadow-lg p-1.5 z-20">
          <p className="px-3 py-2 text-[11px] text-[#9DA29E] truncate">{user.email}</p>
          <button onClick={() => { setOpen(false); onSignOut(); }}
            className="w-full text-left px-3 py-2 text-[13px] font-bold text-[#141815] hover:bg-[#F6F5F2] rounded-lg transition-colors">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-bold text-[#141815] mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[#6E756F] mt-1.5">{hint}</p>}
    </div>
  );
}

const inputClass =
  'w-full bg-white border border-[#D9D6CD] rounded-lg px-3.5 py-3 text-[15px] tnum ' +
  'outline-none transition-colors hover:border-[#B9B5AA] focus:border-[#10231F]';

function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex p-0.5 bg-[#EDEBE5] rounded-lg">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3 py-1.5 text-[12px] font-bold rounded-[6px] transition-colors ${
            value === o.value ? 'bg-white text-[#141815] shadow-sm'
                              : 'text-[#6E756F] hover:text-[#141815]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MacroBar({ macros, calories }) {
  const rows = MACROS.map((m) => {
    const grams = macros[m.key] ?? 0;
    const kcal = grams * m.kcalPerG;
    return { ...m, grams, kcal, pct: calories ? (kcal / calories) * 100 : 0 };
  });

  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-[#E7E4DC] gap-0.5" role="img"
        aria-label={rows.map((r) => `${r.label} ${Math.round(r.pct)} percent`).join(', ')}>
        {rows.map((r, i) => (
          <div key={r.key} className="grow-bar first:rounded-l-full last:rounded-r-full"
            style={{ width: `${r.pct}%`, background: r.color, animationDelay: `${i * 110}ms` }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-5 mt-5">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
              <span className="text-[11px] font-bold text-[#6E756F]">{r.label}</span>
            </div>
            <p className="figure text-[30px] leading-none">
              {Math.round(r.grams)}
              <span className="text-[14px] font-medium text-[#6E756F] ml-0.5">g</span>
            </p>
            <p className="text-[11px] text-[#6E756F] tnum mt-1.5">
              {Math.round(r.kcal)} kcal · {Math.round(r.pct)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuoteBand({ quote }) {
  return (
    <section className="no-print py-16 md:py-20">
      <div className="max-w-[720px]">
        <span className="figure text-[52px] text-[#FF5A1F] leading-none block mb-2"
          aria-hidden="true">&ldquo;</span>
        <blockquote className="text-[24px] md:text-[30px] font-extrabold leading-[1.25]
                               tracking-[-0.02em] balance">
          {quote.text}
        </blockquote>
        <figcaption className="text-[12px] font-bold text-[#6E756F] mt-5">
          {quote.who}
        </figcaption>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- app */

export default function App() {
  const [units, setUnits] = useState('metric');
  const [form, setForm] = useState({
    age: '', height: '', weight: '', heightFt: '', heightIn: '',
    gender: 'male', activity_level: 'sedentary',
    fitness_goal: 'weight loss', diet_type: 'non-vegetarian',
  });
  const [plan, setPlan] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [issuedAt, setIssuedAt] = useState(null);
  const [serverDays, setServerDays] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(true);
  const slowTimer = useRef();

  const [showAuth, setShowAuth] = useState(false);
  const { user, loading: authLoading, signOut, authConfigured } = useAuth();
  const apiFetch = useApiFetch();

  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const readError = async (res) => {
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        return body.detail.map((d) => {
          const f = d.loc?.[d.loc.length - 1];
          return `${FIELD_LABELS[f] ?? f}: ${d.msg}`;
        }).join('. ');
      }
      if (typeof body.detail === 'string') return body.detail;
    } catch { /* fall through to the generic message */ }
    return `Request failed (${res.status}).`;
  };

  const applyProfile = useCallback((data) => {
    setPlan(JSON.parse(data.generated_plan));
    setProfileId(data.id);
    setServerDays(data.completed_days ?? null);
    setIssuedAt(new Date());
    setEditing(false);
    setForm((f) => ({
      ...f,
      age: String(data.age),
      height: String(data.height),
      weight: String(data.weight),
      heightFt: String(Math.floor(data.height / CM_PER_IN / 12)),
      heightIn: String(Math.round((data.height / CM_PER_IN) % 12)),
      gender: data.gender,
      activity_level: data.activity_level,
      fitness_goal: data.fitness_goal,
      diet_type: data.diet_type,
    }));
  }, []);

  // A plan has a stable id, so it has a URL. Reloading or sharing the link
  // brings the plan back instead of an empty form.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    setLoading(true);
    apiFetch(`${API}/api/profile/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('That plan could not be found.'))))
      .then(applyProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applyProfile, apiFetch]);

  const scrollTop = () =>
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

  // Clicking the mark returns to the home view. Non-destructive: an existing
  // plan stays loaded, so Cancel brings it straight back.
  const goHome = () => { setEditing(true); setError(''); scrollTop(); };

  const startOver = () => {
    setPlan(null); setProfileId(null); setIssuedAt(null);
    setEditing(true); setError('');
    setForm({
      age: '', height: '', weight: '', heightFt: '', heightIn: '',
      gender: 'male', activity_level: 'sedentary',
      fitness_goal: 'weight loss', diet_type: 'non-vegetarian',
    });
    window.history.replaceState({}, '', window.location.pathname);
    scrollTop();
  };

  const toMetric = () => {
    if (units === 'metric') {
      return { height: parseFloat(form.height), weight: parseFloat(form.weight) };
    }
    const ft = parseFloat(form.heightFt) || 0;
    const inch = parseFloat(form.heightIn) || 0;
    return {
      height: Math.round((ft * 12 + inch) * CM_PER_IN * 10) / 10,
      weight: Math.round((parseFloat(form.weight) / LBS_PER_KG) * 10) / 10,
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setPlan(null); setProfileId(null);
    // A sleeping free-tier backend can take the better part of a minute to
    // wake. Silence reads as broken, so say what is happening.
    slowTimer.current = setTimeout(() => setSlow(true), 3500);
    try {
      const { height, weight } = toMetric();
      const res = await apiFetch(`${API}/generate/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(form.age, 10), height, weight,
          gender: form.gender, activity_level: form.activity_level,
          fitness_goal: form.fitness_goal, diet_type: form.diet_type,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      applyProfile(data);
      window.history.replaceState({}, '', `?id=${data.id}`);
      scrollTop();
    } catch (err) {
      setError(err.message || 'Could not reach the server.');
    } finally {
      clearTimeout(slowTimer.current);
      setSlow(false);
      setLoading(false);
    }
  };

  const calories = plan?.nutrition?.daily_calories;
  const animatedCalories = useCountUp(calories ?? 0);
  const progress = useWeekProgress(profileId, serverDays, Boolean(user), apiFetch);
  const trainingDays = useMemo(
    () => (plan ? Object.keys(plan.training_matrix) : []), [plan]);
  // The stored profile is always metric; the form may be showing imperial.
  const startKg = parseFloat(form.weight)
    ? (units === 'metric' ? parseFloat(form.weight) : parseFloat(form.weight) / LBS_PER_KG)
    : 0;
  const goalLabel = GOALS.find((g) => g.value === form.fitness_goal)?.label ?? '';
  const appliedGoalLabel = plan?.applied_goal?.replace('_', ' ');
  const goalDiverged = Boolean(
    plan?.applied_goal &&
    !((form.fitness_goal === 'weight loss' && plan.applied_goal === 'fat_loss') ||
      (form.fitness_goal === 'muscle gain' && plan.applied_goal === 'muscle_gain') ||
      (form.fitness_goal === 'maintenance' && plan.applied_goal === 'maintenance'))
  );
  const showPlan = plan && !editing;

  if (showAuth) {
    return (
      <AuthPage
        onDone={() => setShowAuth(false)}
        onSkip={() => setShowAuth(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F5F2] text-[#141815]">
      <a href="#measurements"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-3 focus:left-3
                   focus:bg-white focus:text-[#141815] focus:px-4 focus:py-2 focus:rounded-lg
                   focus:text-[13px] focus:font-bold">
        Skip to the form
      </a>
      <p aria-live="polite" className="sr-only">
        {loading ? 'Calculating your plan' : showPlan ? 'Your plan is ready' : ''}
      </p>

      {/* ------------------------------------------------------------ hero */}
      <div className={`pine-grid pine-grid-drift text-[#F6F5F2] relative overflow-hidden
                       ${showPlan ? 'pb-20' : 'pb-36'} print-plain`}>
        {/* Masked at both ends so the trace reads as a signal passing through
            rather than a stroke that stops dead against the form card. */}
        <PulseLine className="no-print pointer-events-none absolute left-0 right-0 bottom-4
                              h-[120px] w-full opacity-40 pulse-mask" />

        <div className="max-w-[1060px] mx-auto px-5 md:px-8 relative">
          <div className="flex items-center gap-2.5 pt-7">
            <button onClick={goHome} aria-label="OptiFit home"
              className="flex items-center gap-2.5 group">
              <Mark className="w-7 h-7 text-[#F6F5F2] transition-transform group-hover:scale-105" />
              <span className="text-[17px] font-extrabold tracking-[-0.02em]">OptiFit</span>
            </button>
            <div className="no-print ml-auto flex items-center gap-4">
              {showPlan && (
                <>
                  <button onClick={startOver}
                    className="text-[12px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] transition-colors">
                    Start over
                  </button>
                  <button onClick={() => window.print()}
                    className="text-[12px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] border border-white/20 rounded-md px-3 py-1.5 transition-colors">
                    Print plan
                  </button>
                </>
              )}
              {authConfigured && (
                <AccountMenu user={user} loading={authLoading}
                  onSignIn={() => setShowAuth(true)} onSignOut={signOut} />
              )}
            </div>
          </div>

          {!showPlan ? (
            <div className="pt-16 md:pt-20 grid md:grid-cols-[minmax(0,1fr)_auto] gap-12 md:gap-10 items-center">
              <div className="max-w-[560px]">
                <p className="text-[11px] font-bold text-[#FF5A1F] mb-5">
                  Nutrition and training targets
                </p>
                <h1 className="text-[40px] md:text-[56px] font-extrabold leading-[1] tracking-[-0.035em] balance">
                  Know exactly what to eat and how to train this week.
                </h1>
                <p className="text-[15px] md:text-[16px] text-[#A9B5AE] mt-7 leading-relaxed max-w-[480px]">
                  Your calorie target, macro split, and a seven-day training week, calculated
                  from your own measurements with the Mifflin-St Jeor equation. No sign-up.
                </p>
                <div className="flex flex-wrap items-center gap-4 mt-9">
                  <a href="#measurements"
                    className="bg-[#FF5A1F] hover:bg-[#E64A12] text-white text-[14px] font-bold px-7 py-3.5 rounded-lg transition-colors">
                    Build my plan
                  </a>
                  <span className="text-[12px] text-[#7E8C85] font-semibold">
                    Takes about a minute. No sign-up.
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-7 gap-y-2 mt-8 text-[12px] text-[#7E8C85] font-semibold">
                  <span>Private link to your plan</span>
                  <span>Print and take it with you</span>
                  <span>Metric or imperial</span>
                </div>
              </div>
              <div className="no-print hidden md:flex justify-end">
                <HeroSpecimen />
              </div>
            </div>
          ) : (
            // With a plan loaded the hero becomes its header band, so the result
            // reads as a document that was issued rather than a page rendered.
            <div className="pt-14 pb-2">
              <p className="text-[11px] font-bold text-[#FF5A1F] mb-4">Your plan</p>
              <h1 className="figure text-[38px] md:text-[48px] leading-none">{goalLabel}</h1>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6 text-[12px] text-[#A9B5AE] tnum">
                <span>{form.age} yrs</span>
                <span>
                  {units === 'metric'
                    ? `${form.height} cm · ${form.weight} kg`
                    : `${form.heightFt}ft ${form.heightIn || 0}in · ${form.weight} lb`}
                </span>
                <span>BMI {plan.metrics.bmi} · {plan.metrics.bmi_category}</span>
                {profileId && <span>Ref {String(profileId).padStart(4, '0')}</span>}
                {issuedAt && <span>{issuedAt.toLocaleDateString()}</span>}
                <button onClick={() => setEditing(true)}
                  className="no-print font-bold text-[#FF5A1F] hover:underline">
                  Change details
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1060px] mx-auto px-5 md:px-8">

        {/* ----------------------------------------------------------- form */}
        {/* relative + z-10 matters below: the hero is positioned, so a static
            element overlapping it would paint underneath and get clipped. */}
        {editing && (
          <section id="measurements" className="no-print relative z-10 -mt-24 mb-4 scroll-mt-6">
            <div className="bg-white rounded-2xl border border-[#E3E1DA] shadow-[0_1px_3px_rgba(16,35,31,0.05),0_18px_44px_-16px_rgba(16,35,31,0.22)] p-6 md:p-9">
              <div className="flex items-center justify-between gap-4 mb-8">
                <h2 className="text-[15px] font-extrabold">Your measurements</h2>
                <Segmented label="Units" value={units} onChange={setUnits}
                  options={[{ value: 'metric', label: 'kg / cm' }, { value: 'imperial', label: 'lb / ft' }]} />
              </div>

              <form onSubmit={submit} className="space-y-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-6">
                  <Field id="age" label="Age">
                    <input id="age" name="age" type="number" required min={13} max={100}
                      placeholder="28" value={form.age} onChange={change} className={inputClass} />
                  </Field>

                  {units === 'metric' ? (
                    <Field id="height" label="Height" hint="centimetres">
                      <input id="height" name="height" type="number" required min={100} max={250}
                        placeholder="175" value={form.height} onChange={change} className={inputClass} />
                    </Field>
                  ) : (
                    <Field id="heightFt" label="Height" hint="feet and inches">
                      <div className="flex gap-2">
                        <input id="heightFt" name="heightFt" type="number" required min={3} max={8}
                          placeholder="5" value={form.heightFt} onChange={change} className={inputClass} />
                        <input id="heightIn" name="heightIn" type="number" min={0} max={11}
                          placeholder="9" value={form.heightIn} onChange={change} className={inputClass} />
                      </div>
                    </Field>
                  )}

                  <Field id="weight" label="Weight" hint={units === 'metric' ? 'kilograms' : 'pounds'}>
                    <input id="weight" name="weight" type="number" required step="0.1"
                      placeholder={units === 'metric' ? '70' : '154'}
                      value={form.weight} onChange={change} className={inputClass} />
                  </Field>

                  <Field id="gender" label="Gender">
                    <select id="gender" name="gender" value={form.gender} onChange={change} className={inputClass}>
                      {GENDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                </div>

                <div className="h-px bg-[#EDEBE5]" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-6">
                  <Field id="activity_level" label="Activity level"
                    hint={ACTIVITY_LEVELS.find((a) => a.value === form.activity_level)?.hint}>
                    <select id="activity_level" name="activity_level" value={form.activity_level}
                      onChange={change} className={inputClass}>
                      {ACTIVITY_LEVELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>

                  <div className="grid grid-cols-2 gap-5">
                    <Field id="fitness_goal" label="Goal">
                      <select id="fitness_goal" name="fitness_goal" value={form.fitness_goal}
                        onChange={change} className={inputClass}>
                        {GOALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field id="diet_type" label="Diet">
                      <select id="diet_type" name="diet_type" value={form.diet_type}
                        onChange={change} className={inputClass}>
                        {DIETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <button type="submit" disabled={loading}
                    className="bg-[#10231F] hover:bg-[#17352D] disabled:bg-[#A9B5AE] text-[#F6F5F2] text-[14px] font-bold px-7 py-3.5 rounded-lg transition-colors">
                    {loading ? 'Calculating' : 'Calculate my plan'}
                  </button>
                  {plan && (
                    <button type="button" onClick={() => setEditing(false)}
                      className="text-[13px] font-bold text-[#6E756F] hover:text-[#141815]">
                      Cancel
                    </button>
                  )}
                  <p className="text-[11px] text-[#6E756F] ml-auto">
                    Nothing is shared. Your plan gets a private link.
                  </p>
                </div>

                {slow && (
                  <p className="text-[12px] text-[#6E756F] flex items-center gap-2" role="status">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5A1F] animate-pulse" />
                    Waking the server. The first request after a quiet spell can take up to a minute.
                  </p>
                )}

                {error && (
                  <p className="text-[13px] text-[#A8521C] font-medium border-l-2 border-[#A8521C] pl-3">
                    {error}
                  </p>
                )}
              </form>
            </div>

            {/* how it works */}
            <div className="grid md:grid-cols-3 gap-5 mt-14">
              {STEPS.map((s) => (
                <div key={s.n} className="lift bg-white rounded-2xl border border-[#E3E1DA] p-6">
                  <span className="figure text-[13px] text-[#FF5A1F]">{s.n}</span>
                  <h3 className="text-[15px] font-extrabold mt-3">{s.title}</h3>
                  <p className="text-[13px] text-[#6E756F] leading-relaxed mt-2">{s.body}</p>
                </div>
              ))}
            </div>

            {/* the working behind the numbers */}
            <section className="mt-16">
              <h2 className="text-[11px] font-bold text-[#6E756F] mb-7">
                How your numbers are worked out
              </h2>
              <div className="grid md:grid-cols-2 gap-x-10 gap-y-9">
                {METHOD.map((m) => (
                  <div key={m.q}>
                    <h3 className="text-[15px] font-extrabold mb-2.5">{m.q}</h3>
                    <p className="text-[13.5px] text-[#6E756F] leading-relaxed">{m.a}</p>
                  </div>
                ))}
              </div>
            </section>

            <QuoteBand quote={quote} />
          </section>
        )}

        {!editing && error && (
          <p className="no-print mt-8 text-[13px] text-[#A8521C] border-l-2 border-[#A8521C] pl-3">
            {error}
          </p>
        )}

        {/* -------------------------------------------------------- results */}
        {showPlan && (
          <div className="relative z-10 pb-8">

            {plan.warnings?.length > 0 && (
              <div className="rise -mt-12 mb-10 bg-[#FDF5EE] border border-[#E8D5C2] rounded-2xl p-6 print-break">
                <h2 className="text-[12px] font-extrabold text-[#A8521C] mb-3">Read this first</h2>
                <ul className="space-y-2.5">
                  {plan.warnings.map((w, i) => (
                    <li key={i} className="text-[13.5px] leading-relaxed text-[#6B4A32]">{w}</li>
                  ))}
                </ul>
                {goalDiverged && (
                  <p className="text-[13.5px] font-bold text-[#A8521C] mt-3">
                    This plan targets {appliedGoalLabel}, not the goal you chose.
                  </p>
                )}
              </div>
            )}

            <section className={`rise bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break ${
              plan.warnings?.length ? '' : '-mt-12'}`}>
              <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-10 md:gap-14 items-start">
                <div>
                  <p className="text-[11px] font-bold text-[#6E756F] mb-4">Eat each day</p>
                  <div className="flex items-end gap-3">
                    <p className="figure text-[68px] md:text-[84px] leading-[0.8]">{animatedCalories}</p>
                    <p className="text-[14px] text-[#6E756F] pb-2.5 font-semibold">kcal</p>
                  </div>

                  <div className="mt-8 space-y-2.5 text-[12.5px] tnum">
                    <div className="flex justify-between border-b border-[#EDEBE5] pb-2.5">
                      <span className="text-[#6E756F]">Resting burn</span>
                      <span className="font-bold">{plan.metrics.bmr}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#EDEBE5] pb-2.5">
                      <span className="text-[#6E756F]">With your activity</span>
                      <span className="font-bold">{plan.metrics.tdee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6E756F]">
                        {calories >= plan.metrics.tdee ? 'Surplus' : 'Deficit'}
                      </span>
                      <span className="font-bold text-[#FF5A1F]">
                        {calories >= plan.metrics.tdee ? '+' : '-'}
                        {Math.abs(calories - plan.metrics.tdee)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="md:pt-7">
                  <MacroBar macros={plan.nutrition.macros} calories={calories} />
                </div>
              </div>
            </section>

            <section className="rise rise-1 mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break">
              <h2 className="text-[15px] font-extrabold mb-6">A day of eating</h2>
              <div>
                {Object.entries(plan.nutrition.meals).map(([meal, description], i, arr) => (
                  <div key={meal}
                    className={`grid grid-cols-[84px_1fr] md:grid-cols-[110px_1fr_auto] gap-x-4 gap-y-1.5 items-baseline py-4 ${
                      i < arr.length - 1 ? 'border-b border-[#EDEBE5]' : ''}`}>
                    <span className="capitalize text-[13px] font-extrabold">{meal}</span>
                    <span className="text-[14px] text-[#454B47] leading-relaxed">{description}</span>
                    <span className="text-[12.5px] font-bold text-[#6E756F] tnum whitespace-nowrap col-start-2 md:col-start-3">
                      ~{Math.round(calories * (MEAL_SHARE[meal] ?? 0))} kcal
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#6E756F] mt-5">
                Calories split by a typical distribution across the day. Move them around to suit
                your schedule; the daily total is what counts.
              </p>
            </section>

            <section className="rise rise-2 mt-6 print-break">
              <div className="pine-grid text-[#F6F5F2] rounded-2xl overflow-hidden print-plain">
                <div className="px-6 md:px-9 pt-7 pb-5 flex items-baseline justify-between gap-4">
                  <h2 className="text-[15px] font-extrabold">Your training week</h2>
                  <span className="text-[11px] text-[#A9B5AE] font-semibold">
                    {ACTIVITY_LEVELS.find((a) => a.value === form.activity_level)?.label}
                  </span>
                </div>

                <div className="no-print px-6 md:px-9 pb-5">
                  <WeekTracker days={trainingDays} done={progress.done} onReset={progress.reset} />
                </div>

                <div className="px-6 md:px-9 pb-7">
                  {Object.entries(plan.training_matrix).map(([day, workout], i, arr) => {
                    const isDone = Boolean(progress.done[day]);
                    return (
                      <div key={day}
                        className={`grid grid-cols-[28px_38px_1fr] md:grid-cols-[28px_96px_1fr] gap-4 py-4 items-start ${
                          i < arr.length - 1 ? 'border-b border-white/10' : ''}`}>
                        <button onClick={() => progress.toggle(day)}
                          aria-pressed={isDone}
                          aria-label={`Mark ${day} as done`}
                          className={`no-print mt-0.5 w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-colors ${
                            isDone ? 'bg-[#FF5A1F] border-[#FF5A1F]'
                                   : 'border-white/30 hover:border-white/60'}`}>
                          {isDone && (
                            <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden="true">
                              <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#10231F"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <span className={`text-[11px] font-extrabold pt-0.5 transition-colors ${
                          isDone ? 'text-[#5E6E66]' : 'text-[#FF5A1F]'}`}>
                          <span className="md:hidden">{day.slice(0, 3)}</span>
                          <span className="hidden md:inline">{day}</span>
                        </span>
                        <span className={`text-[14px] leading-relaxed transition-colors ${
                          isDone ? 'text-[#5E6E66] line-through' : 'text-[#DDE3DF]'}`}>
                          {workout}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* projection */}
            <section className="rise rise-3 mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break">
              <ProjectionChart startKg={startKg} tdee={plan.metrics.tdee}
                target={calories} units={units} />
            </section>

            {(plan.assumptions?.length > 0 || plan.reference_guidance) && (
              <section className="rise rise-3 mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9">
                {plan.assumptions?.length > 0 && (
                  <div className={plan.reference_guidance ? 'mb-7 pb-7 border-b border-[#EDEBE5]' : ''}>
                    <h2 className="text-[12px] font-extrabold text-[#6E756F] mb-2.5">What was assumed</h2>
                    <ul className="text-[12.5px] text-[#6E756F] space-y-1.5 leading-relaxed">
                      {plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {plan.reference_guidance && (
                  <div>
                    <h2 className="text-[12px] font-extrabold text-[#6E756F]">
                      General guidance for your BMI range
                    </h2>
                    <p className="text-[11px] text-[#9DA29E] mt-1.5 mb-3.5 leading-relaxed">
                      From a reference dataset, based on BMI alone. It does not account for your
                      goal or the targets above.
                    </p>
                    <p className="text-[13px] text-[#6E756F] leading-relaxed">
                      {plan.reference_guidance.exercise_schedule}
                    </p>
                    <p className="text-[13px] text-[#6E756F] leading-relaxed mt-1.5">
                      {plan.reference_guidance.meal_plan}
                    </p>
                  </div>
                )}
              </section>
            )}

            <QuoteBand quote={quote} />
          </div>
        )}

        {/* ---------------------------------------------------------- footer */}
        <footer className="border-t border-[#E3E1DA] py-10">
          <div className="flex items-center gap-2.5 mb-5">
            <Mark className="w-5 h-5 text-[#141815]" />
            <span className="text-[13px] font-extrabold">OptiFit</span>
          </div>
          <p className="text-[11px] text-[#9DA29E] leading-relaxed max-w-[680px]">
            Targets come from the Mifflin-St Jeor equation and standard activity multipliers.
            Meal and training templates are general, not individually programmed. This is not
            medical advice. Talk to a doctor or a registered dietitian before making significant
            changes, particularly if you have a health condition.
            {profileId && <span className="no-print"> Your plan stays at this link.</span>}
          </p>
        </footer>
      </div>
    </div>
  );
}