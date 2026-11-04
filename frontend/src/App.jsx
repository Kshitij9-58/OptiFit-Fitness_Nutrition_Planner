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

// Keyed on the goal the plan actually applied, not the one the form asked for.
// The underweight safety guard can override the request, and the explanation
// has to match the numbers on screen or it misleads.
const GOAL_NOTE = {
  fat_loss:
    'Your calories sit a little below what your body burns, so weight comes off slowly. Aim for about half a kilo (1 lb) a week at most. Faster is not better, and it usually costs you muscle.',
  muscle_gain:
    'Your calories sit a little above what your body burns, so your muscles have fuel to grow. Skipping meals works against you here: eating enough matters as much as training.',
  maintenance:
    'Your calories match what your body burns, so your weight should stay roughly steady. Consistency is the whole goal here.',
};

// Rest days are detected from the session text rather than a flag, because
// the plan templates are plain strings. If a rest day ever renders as a
// training day, widen this pattern to match the wording the template used.
const REST_PATTERN = /\b(rest|recovery|off|active recovery)\b/i;

const LBS_PER_KG = 2.20462;
const CM_PER_IN = 2.54;

/* --------------------------------------------------------------- helpers */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * First name from the name given at sign-up. Returns an empty string when no
 * name is on file, rather than guessing from the email address: a greeting
 * built from "kshitij23@..." is worse than simply asking.
 */
function getFirstName(user) {
  const full = user?.user_metadata?.full_name?.trim();
  return full ? full.split(/\s+/)[0] : '';
}

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

/**
 * A worked example in the hero, set the way a timing board sets a result:
 * the figure first, the detail under it, every digit holding its column.
 */
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
      <p className="text-[11px] text-[#6E756F] mb-3">A worked example</p>
      <div className="flex items-end gap-2">
        <span className="scoreboard text-[48px] leading-[0.78] text-[#141815]">{kcal}</span>
        <span className="text-[12px] text-[#6E756F] pb-1.5 font-semibold">kcal a day</span>
      </div>

      <div className="mt-6 space-y-3">
        {bars.map((b, i) => (
          <div key={b.label}>
            <div className="flex justify-between items-baseline text-[11px] mb-1.5">
              <span className="font-bold text-[#6E756F]">{b.label}</span>
              <span className="scoreboard text-[13px] text-[#141815]">{b.g}g</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-[#EDEBE5] overflow-hidden">
              <div className="h-full rounded-full grow-bar"
                style={{ width: `${b.pct * 2}%`, background: b.color,
                         animationDelay: `${300 + i * 130}ms` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-[#EDEBE5] space-y-2">
        {[['Mon', 'Heavy push'], ['Tue', 'Intervals'], ['Wed', 'Mobility']].map(([d, w]) => (
          <div key={d} className="flex gap-3 text-[11px]">
            <span className="font-extrabold text-[#FF5A1F] w-8">{d}</span>
            <span className="text-[#6E756F]">{w}</span>
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
        <p className="text-[12px] text-[#6E756F]">
          <span className="scoreboard text-[17px] text-[#141815]">
            {toDisplay(startKg).toFixed(1)}
          </span>
          <span className="mx-2">to</span>
          <span className="scoreboard text-[17px] text-[#141815]">
            {toDisplay(endKg).toFixed(1)}
          </span>
          <span className="ml-1">{unitLabel}</span>
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
        {Array.from({ length: 13 }, (_, w) => (
          <line key={w} x1={x(w)} y1={PAD} x2={x(w)} y2={H - PAD}
            stroke="#E3E1DA" strokeWidth="1" strokeOpacity={w % 4 === 0 ? 1 : 0.45} />
        ))}
        {changed && <path d={area} fill="url(#proj)" />}
        <path d={path} className="draw-line" fill="none" stroke="#FF5A1F"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(WEEKS)} cy={y(endKg)} r="4.5" fill="#FF5A1F" />
      </svg>

      <div className="flex justify-between text-[11px] text-[#9DA29E] font-semibold mt-1">
        {[0, 4, 8, 12].map((w) => <span key={w}>{w ? `Week ${w}` : 'Today'}</span>)}
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

function WeekTracker({ days, matrix, done, onReset }) {
  // Rest days are not work to be ticked off, so counting them in the total
  // meant a perfectly executed week could never reach full.
  const sessions = days.filter((d) => !REST_PATTERN.test(matrix[d] ?? ''));
  const count = sessions.filter((d) => done[d]).length;
  const pct = sessions.length ? count / sessions.length : 0;
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
        <p className="text-[13px] font-extrabold">
          <span className="scoreboard text-[15px]">{count}</span>
          <span className="text-[#A9B5AE] font-semibold"> of {sessions.length} sessions done</span>
        </p>
        <p className="text-[11px] text-[#A9B5AE]">
          {count === sessions.length && sessions.length > 0
            ? 'Every session done this week.'
            : 'Tick each session as you finish it.'}
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
function AccountMenu({ user, firstName, onSignIn, onSignOut, loading }) {
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

  const initial = (firstName || user.email || '?').charAt(0).toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex items-center gap-2 text-[12px] font-bold text-[#A9B5AE] hover:text-[#F6F5F2] transition-colors">
        <span className="w-6 h-6 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center text-[11px] font-extrabold">
          {initial}
        </span>
        {/* The first name, not the email: shorter, friendlier, and it fits on
            a phone, so it no longer has to be hidden below the sm breakpoint. */}
        <span className="max-w-[160px] truncate">{firstName || 'Account'}</span>
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

/**
 * Accounts created before the name field existed have no name on file. Rather
 * than guess from the email address, ask once. It disappears as soon as a name
 * is saved, because the greeting then has something real to show.
 */
function NameBanner({ onSave }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    if (!value.trim()) { setError('Please enter your name.'); return; }
    setBusy(true); setError('');
    try {
      await onSave(value);
    } catch (err) {
      setError(err.message || 'Could not save your name. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="no-print bg-[#FDF5EE] border-b border-[#E8D5C2]">
      <form onSubmit={save}
        className="max-w-[1060px] mx-auto px-5 md:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor="bannerName" className="text-[13px] font-bold text-[#6B4A32]">
          Welcome. What should we call you?
        </label>
        <input id="bannerName" type="text" required maxLength={60} autoComplete="name"
          value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="Your name"
          className="bg-white border border-[#E8D5C2] rounded-lg px-3 py-1.5 text-[14px]
                     outline-none focus:border-[#10231F]" />
        <button type="submit" disabled={busy}
          className="bg-[#10231F] hover:bg-[#17352D] disabled:bg-[#A9B5AE] text-[#F6F5F2]
                     text-[12px] font-bold px-4 py-2 rounded-lg transition-colors">
          {busy ? 'Saving' : 'Save'}
        </button>
        {error && <span role="alert" className="text-[12px] text-[#A8521C]">{error}</span>}
      </form>
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

// Numbers you type read back in the same face the results use, so the figure
// you enter and the figure you get are visibly the same kind of thing.
const numberInputClass = inputClass + ' scoreboard text-[17px]';

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

/* ========================================================== track devices

A sprinter reads the world along a marked line: 10m intervals, a split at
each marker, and the velocity curve that rises hard, holds, and decays to the
tape. Energy, macros and the twelve weeks all use that same device, so the
whole readout is measured against one consistent axis rather than scattered
into unrelated cards.
*/

/**
 * A real 100m velocity profile: steep acceleration through 30m, maximum
 * velocity held around 50 to 60m, slight decay to the line. Used instead of
 * a heartbeat trace, which every fitness product reaches for.
 */
function VelocityCurve({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 1200 170" fill="none"
      preserveAspectRatio="none" aria-hidden="true">
      {/* ten-metre markers */}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={i * 120} y1="0" x2={i * 120} y2="170"
          stroke="#F6F5F2" strokeOpacity={i % 3 === 0 ? 0.13 : 0.06} strokeWidth="1" />
      ))}
      <path className="velocity-draw"
        d="M0 158 C 60 142, 140 94, 240 64 C 330 38, 420 27, 540 25
           C 700 23, 880 33, 1200 53"
        stroke="#FF5A1F" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Horizontal scale with the three energy figures placed on one axis. Reading
 * resting burn, daily burn and target as positions on a shared line makes the
 * size of the gap legible at a glance, which three separate numbers in a
 * table never manage.
 */
function EnergyScale({ bmr, tdee, target }) {
  // The single piece of non-interactive motion in the whole readout: the
  // headline figure counting up once on arrival, like a timing board
  // settling. Everything else stays still.
  const shown = useCountUp(target ?? 0);
  const max = Math.max(tdee, target) * 1.08;
  const at = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const deficit = target < tdee;
  const gap = Math.abs(target - tdee);

  // Ticks every 500 kcal, the way distance markers sit every ten metres.
  const ticks = [];
  for (let v = 500; v < max; v += 500) ticks.push(v);

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="scoreboard text-[64px] md:text-[80px] leading-[0.78]">{shown}</span>
        <span className="text-[14px] text-[#6E756F] pb-2 font-semibold">kcal a day</span>
      </div>

      <div className="relative h-[52px] mt-8" role="img"
        aria-label={`Resting burn ${bmr}, daily burn ${tdee}, target ${target} kcal`}>
        {/* the field */}
        <div className="absolute inset-x-0 top-[18px] h-[14px] bg-[#EDEBE5] rounded-[3px]" />

        {ticks.map((v) => (
          <div key={v} className="absolute top-[18px] h-[14px] w-px bg-[#D9D6CD]"
            style={{ left: `${at(v)}%` }} />
        ))}

        {/* resting burn, the part of the target you spend doing nothing */}
        <div className="absolute top-[18px] h-[14px] bg-[#C9BFA8] rounded-l-[3px]"
          style={{ width: `${at(bmr)}%` }} />

        {/* the rest of the target */}
        <div className="absolute top-[18px] h-[14px] bg-[#FF5A1F]"
          style={{ left: `${at(bmr)}%`, width: `${Math.max(at(target) - at(bmr), 0)}%` }} />

        {/* daily burn sits as a post, so the gap to target reads as distance */}
        <div className="absolute top-[10px] h-[30px] w-[2px] bg-[#10231F]"
          style={{ left: `${at(tdee)}%` }} />
        <span className="absolute top-0 text-[10px] font-bold text-[#10231F] whitespace-nowrap"
          style={{ left: `${at(tdee)}%`, transform: 'translateX(-50%)' }}>
          burn
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-4 mt-3 text-[12px]">
        <div>
          <dt className="text-[#6E756F]">Resting burn</dt>
          <dd className="scoreboard text-[20px] mt-1">{bmr}</dd>
        </div>
        <div>
          <dt className="text-[#6E756F]">With your activity</dt>
          <dd className="scoreboard text-[20px] mt-1">{tdee}</dd>
        </div>
        <div>
          <dt className="text-[#6E756F]">{deficit ? 'Short of your burn' : 'Above your burn'}</dt>
          <dd className="scoreboard text-[20px] mt-1 text-[#FF5A1F]">
            {deficit ? '\u2212' : '+'}{gap}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The three macros run the same track, measured against the day's calories,
 * so their relative size is read by how far each one gets rather than by
 * comparing three unrelated numbers.
 */
function MacroLanes({ macros, calories }) {
  const rows = MACROS.map((m) => {
    const grams = macros[m.key] ?? 0;
    const kcal = grams * m.kcalPerG;
    return { ...m, grams, kcal, pct: calories ? (kcal / calories) * 100 : 0 };
  });

  return (
    <div>
      <h3 className="text-[15px] font-extrabold mb-6">What those calories are made of</h3>
      <div className="space-y-5">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[13px] font-bold">{r.label}</span>
              <span className="text-[12px] text-[#6E756F]">
                <span className="scoreboard text-[16px] text-[#141815]">{Math.round(r.grams)}</span>
                <span className="ml-1">grams, {Math.round(r.pct)} percent of the day</span>
              </span>
            </div>
            <div className="relative h-[10px] bg-[#EDEBE5] rounded-[3px] overflow-hidden">
              {[25, 50, 75].map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-[#D9D6CD]" style={{ left: `${t}%` }} />
              ))}
              <div className="absolute inset-y-0 left-0 rounded-[3px] grow-bar"
                style={{ width: `${r.pct}%`, background: r.color }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#6E756F] mt-5 leading-relaxed">
        Marks sit at a quarter, a half and three quarters of your daily calories.
      </p>
    </div>
  );
}

/**
 * The training week as a start list.
 */
function SessionBoard({ days, matrix, done, onToggle }) {
  return (
    <div className="px-6 md:px-9 pb-7">
      {days.map((day, i) => {
        const workout = matrix[day];
        const isRest = REST_PATTERN.test(workout);
        const isDone = Boolean(done[day]);
        return (
          <div key={day}
            className={`grid grid-cols-[26px_40px_1fr] md:grid-cols-[26px_104px_1fr] gap-4 py-4 items-start ${
              i < days.length - 1 ? 'border-b border-white/10' : ''}`}>

            {isRest ? (
              <span className="mt-0.5 w-[18px] h-[18px] rounded-[5px] border border-white/15"
                aria-hidden="true" />
            ) : (
              <button onClick={() => onToggle(day)} aria-pressed={isDone}
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
            )}

            <span className={`text-[11px] font-extrabold pt-0.5 transition-colors ${
              isRest ? 'text-[#5E6E66]' : isDone ? 'text-[#5E6E66]' : 'text-[#FF5A1F]'}`}>
              <span className="md:hidden">{day.slice(0, 3)}</span>
              <span className="hidden md:inline">{day}</span>
            </span>

            <span className={`text-[14px] leading-relaxed transition-colors ${
              isRest ? 'text-[#7E8C85] italic'
                     : isDone ? 'text-[#5E6E66] line-through' : 'text-[#DDE3DF]'}`}>
              {workout}
            </span>
          </div>
        );
      })}
    </div>
  );
}


/* ================================================== the runner and friends */

/**
 * A sprinter built as a sport pictogram: heavy round-capped strokes, one
 * side set back in tone so the near and far limbs read apart, and a forward
 * lean with the head ahead of the shoulders, which at this size does more to
 * say "sprint" than any amount of anatomy would. Cadence comes in as a CSS
 * variable so the same figure can walk, jog or fly.
 */
function Runner({ cadence = '0.46s', className = '' }) {
  const side = (front) => {
    const t = front ? 'lf' : 'lb';
    const a = front ? 'A' : 'B';
    return (
      <>
        <g className={`thigh${a}`}>
          <line className={`${t} w-thigh`} x1="96" y1="112" x2="96" y2="152" />
          <g className={`shin${a}`}>
            <line className={`${t} w-shin`} x1="96" y1="152" x2="96" y2="188" />
            <line className={`${t} w-shin`} x1="96" y1="188" x2="110" y2="190" />
          </g>
        </g>
        <g className={`arm${a}`}>
          <line className={`${t} w-arm`} x1="106" y1="64" x2="106" y2="94" />
          <g className={`fore${a}`}>
            <line className={`${t} w-fore`} x1="106" y1="94" x2="106" y2="120" />
          </g>
        </g>
      </>
    );
  };
  return (
    <svg className={`runner ${className}`} viewBox="0 0 200 200"
      style={{ '--cad': cadence, overflow: 'visible' }} aria-hidden="true">
      <g className="rn-bob">
        {side(false)}
        <line className="lf w-torso" x1="106" y1="64" x2="96" y2="112" />
        <circle cx="117" cy="46" r="13" fill="#FF5A1F" />
        {side(true)}
      </g>
    </svg>
  );
}

/* ------------------------------------------ what a thing costs to work off */

const BURN_FOODS = [
  { n: 'Slice of pizza', k: 285 }, { n: 'Chocolate bar', k: 230 },
  { n: 'Banana', k: 105 },         { n: 'Cheeseburger', k: 550 },
  { n: 'Latte', k: 190 },          { n: 'Samosa', k: 260 },
  { n: 'Can of cola', k: 140 },    { n: 'Plate of biryani', k: 480 },
  { n: 'Two rotis', k: 210 },      { n: 'Handful of almonds', k: 170 },
];

// Interval work carries no kph: the rest between reps is most of the session,
// so an average speed across it would be meaningless.
const BURN_ACTS = [
  { n: 'Walking',         met: 3.5,  cad: '1.15s', kph: 5 },
  { n: 'Climbing stairs', met: 8.8,  cad: '0.72s', kph: 0 },
  { n: 'Cycling',         met: 7.5,  cad: '0.62s', kph: 18 },
  { n: 'Jogging',         met: 8,    cad: '0.62s', kph: 8 },
  { n: 'Running hard',    met: 11.5, cad: '0.44s', kph: 12 },
  { n: 'Sprint repeats',  met: 15,   cad: '0.3s',  kph: 0 },
];

function Chip({ on, children, ...rest }) {
  return (
    <button type="button" aria-pressed={on} {...rest}
      className={`text-[12.5px] font-semibold px-[15px] py-[10px] rounded-full border transition-colors ${
        on ? 'bg-[#FF5A1F] border-[#FF5A1F] text-white'
           : 'bg-white/[0.04] border-white/[0.14] text-[#8FA39B] hover:text-[#F6F5F2] hover:border-white/30'}`}>
      {children}
    </button>
  );
}

/**
 * Minutes come from MET values: kcal per minute is MET x 3.5 x bodyweight in
 * kg / 200. One MET is taken off first, because that is resting metabolism by
 * definition and you would have burned it sitting still. Counting it as
 * exercise is the usual error in these calculators and makes every session
 * look cheaper than it was.
 */
function BurnPanel() {
  const [foodI, setFoodI] = useState(0);
  const [actI, setActI] = useState(3);
  const [kg, setKg] = useState(70);

  const food = BURN_FOODS[foodI];
  const act = BURN_ACTS[actI];
  const perMin = (act.met - 1) * 3.5 * kg / 200;
  const mins = Math.max(1, Math.round(food.k / perMin));
  const dist = act.kph ? (act.kph * mins) / 60 : 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_0.92fr] lg:gap-12 items-start">
      <div>
        <p className="text-[12.5px] font-bold mb-3">Pick something you ate</p>
        <div className="flex flex-wrap gap-2">
          {BURN_FOODS.map((f, i) => (
            <Chip key={f.n} on={i === foodI} onClick={() => setFoodI(i)}>
              {f.n} <b className={i === foodI ? 'text-white' : 'text-[#F6F5F2]'}>{f.k}</b>
            </Chip>
          ))}
        </div>

        <p className="text-[12.5px] font-bold mt-7 mb-3">Pick how you would work it off</p>
        <div className="flex flex-wrap gap-2">
          {BURN_ACTS.map((a, i) => (
            <Chip key={a.n} on={i === actI} onClick={() => setActI(i)}>{a.n}</Chip>
          ))}
        </div>

        <div className="mt-7">
          <div className="flex items-baseline justify-between mb-3">
            <label htmlFor="burnKg" className="text-[12.5px] font-bold">Your weight</label>
            <span className="scoreboard text-[19px] text-[#FF5A1F]">{kg} kg</span>
          </div>
          <input id="burnKg" type="range" min={45} max={130} step={1} value={kg}
            onChange={(e) => setKg(+e.target.value)} className="range-track" />
        </div>
      </div>

      <div className="bg-gradient-to-b from-[#12302A] to-[#0B1E1A] border border-white/[0.09]
                      rounded-[20px] p-7 text-center">
        <div className="h-[128px] grid place-items-center mb-1.5">
          <Runner cadence={act.cad} className="w-[104px] h-[122px]" />
        </div>
        <div className="flex items-end justify-center gap-2.5">
          <span className="scoreboard text-[clamp(56px,9vw,78px)] leading-[0.8]">{mins}</span>
          <span className="text-[13px] text-[#8FA39B] font-bold pb-2">minutes</span>
        </div>
        <p className="text-[14.5px] font-bold leading-snug mt-4 mx-auto max-w-[30ch]">
          {act.n.toLowerCase()} to work off {food.n.toLowerCase()}
        </p>
        <p className="text-[12.5px] text-[#8FA39B] leading-relaxed mt-2.5 mx-auto max-w-[34ch]">
          {dist ? `Roughly ${dist.toFixed(1)} km at ${kg} kg. ` : `Worked out for ${kg} kg. `}
          None of this is a reason to skip the food.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------- the three kinds of work, moving */

function DisciplineCards() {
  const card = 'relative bg-gradient-to-b from-[#12302A] to-[#0C1F1B] border ' +
    'border-white/[0.08] rounded-[18px] p-6 overflow-hidden transition-transform ' +
    'duration-300 hover:-translate-y-1 hover:border-[#FF5A1F]/40';
  const tag = 'absolute top-[18px] right-5 scoreboard text-[13px] text-[#FF5A1F]';

  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className={card}>
        <span className={tag}>6 x 150m</span>
        <div className="h-[112px] grid place-items-center mb-4">
          <Runner className="w-[96px] h-[110px]" />
        </div>
        <h4 className="text-[16px] font-extrabold mb-2">Run</h4>
        <p className="text-[13px] text-[#8FA39B] leading-relaxed">
          Short hard efforts with a full walk back. The session that costs the most
          and takes the least time.
        </p>
      </div>

      <div className={card}>
        <span className={tag}>8 reps</span>
        <div className="h-[112px] grid place-items-center mb-4">
          <svg viewBox="0 0 128 96" className="w-32 h-24" aria-hidden="true">
            <line x1="20" y1="30" x2="20" y2="86" stroke="#2A4B41" strokeWidth="7" strokeLinecap="round" />
            <line x1="108" y1="30" x2="108" y2="86" stroke="#2A4B41" strokeWidth="7" strokeLinecap="round" />
            <g className="rig-press">
              <line x1="16" y1="40" x2="112" y2="40" stroke="#F6F5F2" strokeWidth="5" strokeLinecap="round" />
              <rect x="24" y="22" width="9" height="36" rx="3" fill="#FF5A1F" />
              <rect x="36" y="28" width="7" height="24" rx="3" fill="#C9BFA8" />
              <rect x="95" y="22" width="9" height="36" rx="3" fill="#FF5A1F" />
              <rect x="85" y="28" width="7" height="24" rx="3" fill="#C9BFA8" />
            </g>
          </svg>
        </div>
        <h4 className="text-[16px] font-extrabold mb-2">Lift</h4>
        <p className="text-[13px] text-[#8FA39B] leading-relaxed">
          Pick a weight where the last two reps feel hard and your form still holds.
          Add a little each week.
        </p>
      </div>

      <div className={card}>
        <span className={tag}>2 days</span>
        <div className="h-[112px] grid place-items-center mb-4">
          <svg viewBox="0 0 96 96" className="breathe w-24 h-24" aria-hidden="true">
            <circle className="b3" cx="48" cy="48" r="40" fill="none"
              stroke="#2F6F5E" strokeWidth="3" />
            <circle className="b2" cx="48" cy="48" r="40" fill="none"
              stroke="#2F6F5E" strokeWidth="3" />
            <circle className="b1" cx="48" cy="48" r="40" fill="none"
              stroke="#FF5A1F" strokeWidth="3" />
            <circle cx="48" cy="48" r="9" fill="#FF5A1F" />
          </svg>
        </div>
        <h4 className="text-[16px] font-extrabold mb-2">Recover</h4>
        <p className="text-[13px] text-[#8FA39B] leading-relaxed">
          You get stronger while you rest, not while you train. Rest days are part of
          the programme, not a gap in it.
        </p>
      </div>
    </div>
  );
}

/**
 * Numbers alone do not tell someone new to this what to actually do on Monday
 * morning. Each step uses the person's own targets rather than generic advice,
 * and hand measures are used instead of a kitchen scale on purpose: a rule you
 * can follow in a canteen beats a precise one you abandon in a week.
 */
function DietGuide({ calories, proteinG, goal, vegetarian }) {
  const proteinFoods = vegetarian
    ? 'paneer, tofu, eggs, dal or Greek yoghurt'
    : 'chicken, fish, eggs, dal or tofu';

  const steps = [
    ['Treat the calories as a daily budget.',
      `Aim for about ${calories} kcal across the whole day. Within 100 either side is fine. You do not need to hit it exactly, and one day does not decide anything.`],
    ['Build every meal around protein first.',
      `Your daily target is about ${Math.round(proteinG)} g. A palm-sized portion of ${proteinFoods} is roughly 20 to 30 g, so three or four portions a day gets you most of the way there.`],
    ['Measure with your hand, not a scale.',
      'A palm is one protein portion. A closed fist is one portion of rice, pasta or potato. A cupped hand is one portion of fruit. A thumb is one portion of oil, butter or nuts.'],
    ['Swap foods freely.',
      'Replace anything with something similar and keep the portion size the same: rice for roti, chicken for fish, apple for banana. The plan is a shape, not a shopping list.'],
    ['Drink water through the day.',
      'Roughly 2 to 3 litres. A glass before each meal helps, and thirst is often mistaken for hunger.'],
    ['Cook ahead where you can.',
      'Making two or three meals in bulk at the weekend is what keeps a busy Wednesday from becoming a takeaway.'],
    ['Missed a meal or ate off plan?',
      'Carry on with the next meal as normal. Do not skip food later to make up for it. Consistency across a week beats being perfect for two days.'],
  ];

  return (
    <div className="mt-8 pt-7 border-t border-[#EDEBE5]">
      <h3 className="text-[13px] font-extrabold mb-1.5">How to follow this</h3>
      <p className="text-[13px] text-[#6E756F] leading-relaxed mb-6">
        {GOAL_NOTE[goal] ?? GOAL_NOTE.maintenance}
      </p>

      <ol className="space-y-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="figure text-[13px] text-[#FF5A1F] pt-0.5">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="text-[13.5px] text-[#454B47] leading-relaxed">
              <b className="text-[#141815]">{title}</b> {body}
            </p>
          </li>
        ))}
      </ol>

      <details className="mt-6 text-[13px] text-[#6E756F] leading-relaxed">
        <summary className="cursor-pointer font-bold text-[#141815]">
          What do protein, carbs and fat actually mean?
        </summary>
        <p className="mt-2.5">
          <b>Protein</b> repairs and builds muscle: meat, fish, eggs, dairy, lentils, tofu.{' '}
          <b>Carbs</b> are your main source of energy: rice, bread, fruit, potatoes, oats.{' '}
          <b>Fat</b> supports your hormones and keeps you full: nuts, oil, cheese, avocado.{' '}
          <b>kcal</b> is a unit of energy, the same thing most people just call calories.
        </p>
      </details>
    </div>
  );
}

/**
 * The training equivalent. Deliberately explains the vocabulary the plan uses
 * ("3 x 10", "push day"), because a template written in gym shorthand is not
 * actually usable by the person who most needs the structure.
 */
function TrainingGuide() {
  const steps = [
    ['Warm up for five minutes first.',
      'Brisk walking, arm circles and a few bodyweight squats before every session. It is the cheapest injury prevention there is.'],
    ['Read the sets and reps like this.',
      '"3 x 10" means do the movement 10 times, rest, and repeat that three times in total.'],
    ['Pick a weight that feels challenging.',
      'The last two reps of a set should feel hard while your form stays clean. If you could do five more, go heavier next time.'],
    ['Rest 60 to 90 seconds between sets.',
      'Use your phone timer rather than guessing. Rushing the rest makes the next set worse, not better.'],
    ['Rest days are part of the plan.',
      'You get stronger while you recover, not while you train. Skipping rest days slows you down.'],
    ['Tick each session off as you finish it.',
      'The ring above fills as you go. Watching a week complete itself is the most reliable motivation there is.'],
    ['Stop if something hurts.',
      'A burning muscle is normal. Sharp pain, or pain in a joint, is not. Stop that movement and come back to it another day.'],
  ];

  return (
    <div className="no-print px-6 md:px-9 pb-8 pt-6 border-t border-white/10">
      <h3 className="text-[13px] font-extrabold mb-5">How to follow this</h3>

      <ol className="space-y-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="figure text-[13px] text-[#FF5A1F] pt-0.5">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="text-[13.5px] leading-relaxed">
              <b className="text-[#F6F5F2]">{title}</b>{' '}
              <span className="text-[#A9B5AE]">{body}</span>
            </p>
          </li>
        ))}
      </ol>

      <details className="mt-6 text-[13px] text-[#A9B5AE] leading-relaxed">
        <summary className="cursor-pointer font-bold text-[#F6F5F2]">
          Words in the plan you might not know
        </summary>
        <p className="mt-2.5">
          <b className="text-[#DDE3DF]">Rep</b>: one full movement, like a single push-up.{' '}
          <b className="text-[#DDE3DF]">Set</b>: a group of reps done back to back.{' '}
          <b className="text-[#DDE3DF]">Push day</b>: chest, shoulders and triceps.{' '}
          <b className="text-[#DDE3DF]">Pull day</b>: back and biceps.{' '}
          <b className="text-[#DDE3DF]">Intervals</b>: short hard efforts with easy recovery between them.{' '}
          <b className="text-[#DDE3DF]">Mobility</b>: gentle stretching and joint movement.{' '}
          <b className="text-[#DDE3DF]">Form</b>: doing a movement correctly and safely.
        </p>
      </details>

      <p className="text-[12px] text-[#7E8C85] mt-5 leading-relaxed">
        New to exercise, coming back from an injury, or managing a health condition?
        Check with a doctor before you start.
      </p>
    </div>
  );
}

/**
 * The last thing on the page should give someone a reason to come back
 * tomorrow, not a list of what the product cannot do. The caveats already
 * live in the footer and in the plan's own warnings, which is where they
 * belong.
 */
function ClosingNote() {
  return (
    <section className="no-print py-16 md:py-20">
      <div className="max-w-[640px]">
        <p className="text-[clamp(24px,3.4vw,34px)] font-extrabold leading-[1.18]
                      tracking-[-0.03em] balance">
          Nobody gets fitter in a week. They get fitter in the weeks they
          kept showing up.
        </p>
        <p className="text-[14.5px] text-[#6E756F] leading-relaxed mt-6 max-w-[52ch]">
          So the plan is built to be followed on a bad day, not just a good one.
          Hand measures instead of a kitchen scale, swaps for anything you do not
          have in, and rest days written in rather than left as gaps.
        </p>
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
  const { user, loading: authLoading, signOut, authConfigured, updateFullName } = useAuth();
  const apiFetch = useApiFetch();

  const firstName = getFirstName(user);

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
    setPlan(null); setProfileId(null); setIssuedAt(null); setServerDays(undefined);
    setEditing(true); setError('');
    setForm({
      age: '', height: '', weight: '', heightFt: '', heightIn: '',
      gender: 'male', activity_level: 'sedentary',
      fitness_goal: 'weight loss', diet_type: 'non-vegetarian',
    });
    window.history.replaceState({}, '', window.location.pathname);
    scrollTop();
  };

  // The plan lives in this component's state, and that state outlives a
  // sign-out. Without this, the next person to sign in on the same browser
  // saw the previous person's plan, body measurements included. Clear it when
  // an account signs out or is replaced by a different one.
  // Signed out to signed in is left alone on purpose: a plan someone built
  // anonymously just before signing up is still theirs.
  const userId = user?.id ?? null;
  const previousUserId = useRef(null);
  useEffect(() => {
    if (authLoading) return;
    if (previousUserId.current && previousUserId.current !== userId) startOver();
    previousUserId.current = userId;
    // startOver is recreated every render and only touches state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authLoading]);

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

      {user && !authLoading && !firstName && <NameBanner onSave={updateFullName} />}

      {/* ------------------------------------------------------------ hero */}
      <div className={`pine-grid pine-grid-drift text-[#F6F5F2] relative overflow-hidden
                       ${showPlan ? 'pb-20' : 'pb-36'} print-plain`}>
        {/* Masked at both ends so the trace reads as a signal passing through
            rather than a stroke that stops dead against the form card. */}
        <div className="no-print lane-sweep" aria-hidden="true" />
        <div className="no-print glow glow-a" aria-hidden="true" />
        <div className="no-print glow glow-b" aria-hidden="true" />
        {!showPlan && (
          <span className="no-print watermark scoreboard" aria-hidden="true">100</span>
        )}
        <VelocityCurve className="no-print velocity-mask pointer-events-none absolute left-0 right-0 bottom-0
                                  h-[170px] w-full opacity-45" />

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
                <AccountMenu user={user} firstName={firstName} loading={authLoading}
                  onSignIn={() => setShowAuth(true)} onSignOut={signOut} />
              )}
            </div>
          </div>

          {!showPlan ? (
            <div className="pt-16 md:pt-20 grid md:grid-cols-[minmax(0,1fr)_auto] gap-12 md:gap-10 items-center">
              <div className="max-w-[560px]">
                {/* The eyebrow does double duty: it greets you once you have an
                    account, and labels the product before you do. */}
                <p className="flex items-center gap-2.5 text-[12px] font-bold text-[#FF5A1F] mb-5">
                  <i className="kick-line" aria-hidden="true" />
                  {firstName ? `Welcome back, ${firstName}` : 'Built by a sprinter'}
                </p>
                <h1 className="text-[42px] md:text-[64px] font-extrabold leading-[0.96]
                               tracking-[-0.042em] balance">
                  <span className="ln"><span>Know what to eat.</span></span>
                  <span className="ln ln-1"><span>Know how to train.</span></span>
                  <span className="ln ln-2"><span className="text-[#FF5A1F]">Every week.</span></span>
                </h1>
                <p className="fade-up fade-1 text-[15px] md:text-[16px] text-[#A9B5AE] mt-7 leading-relaxed max-w-[480px]">
                  Your calorie target, macro split, and a seven-day training week, calculated
                  from your own measurements with the Mifflin-St Jeor equation. Every plan comes
                  with plain-language instructions for following it. No sign-up needed.
                </p>
                <div className="fade-up fade-2 flex flex-wrap items-center gap-4 mt-9">
                  <a href="#measurements"
                    className="go-ring bg-[#FF5A1F] hover:bg-[#E64A12] text-white text-[14px]
                               font-bold px-8 py-4 rounded-xl transition-transform
                               hover:-translate-y-0.5 shadow-[0_10px_30px_-10px_rgba(255,90,31,0.67)]">
                    Build my plan
                  </a>
                  <span className="text-[12px] text-[#7E8C85] font-semibold">
                    Takes about a minute. No sign-up.
                  </span>
                </div>
                <div className="fade-up fade-3 flex flex-wrap gap-x-7 gap-y-2 mt-8
                                text-[12px] text-[#7E8C85] font-semibold">
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
            // A start list carries a bib number and the competitor's details.
            // The plan reference doubles as the bib, which is why it is set
            // large rather than tucked into a row of metadata.
            <div className="pt-14 pb-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                {profileId && (
                  <div className="shrink-0">
                    <span className="scoreboard text-[44px] md:text-[56px] leading-[0.8] text-[#FF5A1F]">
                      {String(profileId).padStart(3, '0')}
                    </span>
                  </div>
                )}
                <div>
                  <h1 className="figure text-[34px] md:text-[44px] leading-none">
                    {firstName ? `${firstName}, you are training to ${goalLabel.toLowerCase()}` : goalLabel}
                  </h1>
                </div>
              </div>

              <dl className="flex flex-wrap gap-x-9 gap-y-3 mt-7 text-[12px]">
                <div>
                  <dt className="text-[#7E8C85]">Age</dt>
                  <dd className="scoreboard text-[17px] text-[#F6F5F2] mt-0.5">{form.age}</dd>
                </div>
                <div>
                  <dt className="text-[#7E8C85]">Height</dt>
                  <dd className="scoreboard text-[17px] text-[#F6F5F2] mt-0.5">
                    {units === 'metric'
                      ? `${form.height}cm`
                      : `${form.heightFt}'${form.heightIn || 0}"`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#7E8C85]">Weight</dt>
                  <dd className="scoreboard text-[17px] text-[#F6F5F2] mt-0.5">
                    {form.weight}{units === 'metric' ? 'kg' : 'lb'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#7E8C85]">BMI</dt>
                  <dd className="scoreboard text-[17px] text-[#F6F5F2] mt-0.5">
                    {plan.metrics.bmi}
                    <span className="ml-2 text-[12px] font-semibold text-[#A9B5AE]">
                      {plan.metrics.bmi_category}
                    </span>
                  </dd>
                </div>
                {issuedAt && (
                  <div>
                    <dt className="text-[#7E8C85]">Issued</dt>
                    <dd className="scoreboard text-[17px] text-[#F6F5F2] mt-0.5">
                      {issuedAt.toLocaleDateString()}
                    </dd>
                  </div>
                )}
              </dl>

              <button onClick={() => setEditing(true)}
                className="no-print mt-6 text-[12px] font-bold text-[#FF5A1F] hover:underline">
                Change your details
              </button>
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
                      placeholder="28" value={form.age} onChange={change} className={numberInputClass} />
                  </Field>

                  {units === 'metric' ? (
                    <Field id="height" label="Height" hint="centimetres">
                      <input id="height" name="height" type="number" required min={100} max={250}
                        placeholder="175" value={form.height} onChange={change} className={numberInputClass} />
                    </Field>
                  ) : (
                    <Field id="heightFt" label="Height" hint="feet and inches">
                      <div className="flex gap-2">
                        <input id="heightFt" name="heightFt" type="number" required min={3} max={8}
                          placeholder="5" value={form.heightFt} onChange={change} className={numberInputClass} />
                        <input id="heightIn" name="heightIn" type="number" min={0} max={11}
                          placeholder="9" value={form.heightIn} onChange={change} className={numberInputClass} />
                      </div>
                    </Field>
                  )}

                  <Field id="weight" label="Weight" hint={units === 'metric' ? 'kilograms' : 'pounds'}>
                    <input id="weight" name="weight" type="number" required step="0.1"
                      placeholder={units === 'metric' ? '70' : '154'}
                      value={form.weight} onChange={change} className={numberInputClass} />
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

            {/* Three steps in order, so they sit as markers along one line
                rather than three identical cards that imply no sequence. */}
            <div className="mt-16">
              <div className="h-px bg-[#D9D6CD]" />
              <ol className="grid md:grid-cols-3 gap-x-8 gap-y-10">
                {STEPS.map((step) => (
                  <li key={step.n} className="relative pt-6">
                    <span className="absolute top-0 left-0 w-[2px] h-4 bg-[#FF5A1F]" aria-hidden="true" />
                    <span className="scoreboard text-[13px] text-[#FF5A1F]">{step.n}</span>
                    <h3 className="text-[15px] font-extrabold mt-2">{step.title}</h3>
                    <p className="text-[13px] text-[#6E756F] leading-relaxed mt-2">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>

            {/* Something to play with before anyone is asked to fill in a
                form. Everyone has wondered what a chocolate bar costs, and
                no sport knowledge is needed to find out. */}
            <section className="mt-20 pt-16 border-t border-[#D9D6CD]">
              <h2 className="text-[22px] md:text-[30px] font-extrabold tracking-[-0.025em] mb-8">
                What does it actually cost to eat?
              </h2>
              <div className="bg-[#0E241F] rounded-[22px] p-6 md:p-9 text-[#F6F5F2]">
                <BurnPanel />
              </div>
            </section>

            <section className="mt-20">
              <h2 className="text-[22px] md:text-[30px] font-extrabold tracking-[-0.025em] mb-8">
                Three kinds of work, one week
              </h2>
              <div className="text-[#F6F5F2]">
                <DisciplineCards />
              </div>
            </section>

            {/* the working behind the numbers */}
            <section className="mt-20">
              <h2 className="text-[22px] font-extrabold tracking-[-0.02em] mb-8">
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

            <ClosingNote />
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
              <div className="-mt-12 mb-10 bg-[#FDF5EE] border border-[#E8D5C2] rounded-2xl p-6 print-break">
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

            {/* Energy and macros share one band because they answer one
                question: what the day's calories are, and what they are made
                of. Splitting them into two cards implied two topics. */}
            <section className={`bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break ${
              plan.warnings?.length ? '' : '-mt-12'}`}>
              <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-10 md:gap-14 items-start">
                <EnergyScale bmr={plan.metrics.bmr} tdee={plan.metrics.tdee} target={calories} />
                <div className="md:pt-2">
                  <MacroLanes macros={plan.nutrition.macros} calories={calories} />
                </div>
              </div>
            </section>

            <section className="mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break">
              <h2 className="text-[15px] font-extrabold mb-6">A day of eating</h2>
              <div>
                {Object.entries(plan.nutrition.meals).map(([meal, description], i, arr) => (
                  <div key={meal}
                    className={`grid grid-cols-[84px_1fr] md:grid-cols-[110px_1fr_auto] gap-x-4 gap-y-1.5 items-baseline py-4 ${
                      i < arr.length - 1 ? 'border-b border-[#EDEBE5]' : ''}`}>
                    <span className="capitalize text-[13px] font-extrabold">{meal}</span>
                    <span className="text-[14px] text-[#454B47] leading-relaxed">{description}</span>
                    <span className="text-[12.5px] text-[#6E756F] whitespace-nowrap col-start-2 md:col-start-3">
                      <span className="scoreboard text-[15px] text-[#141815]">
                        {Math.round(calories * (MEAL_SHARE[meal] ?? 0))}
                      </span>
                      <span className="ml-1">kcal</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#6E756F] mt-5">
                Calories split by a typical distribution across the day. Move them around to suit
                your schedule; the daily total is what counts.
              </p>

              <DietGuide
                calories={calories}
                proteinG={plan.nutrition.macros.protein_g}
                goal={plan.applied_goal}
                vegetarian={form.diet_type === 'vegetarian'}
              />
            </section>

            {/* The training week is a start list: the day, the session, and
                a mark you make once it is done. */}
            <section className="mt-6 print-break">
              <div className="pine-grid text-[#F6F5F2] rounded-2xl overflow-hidden print-plain">
                <div className="px-6 md:px-9 pt-7 pb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-[15px] font-extrabold">Your training week</h2>
                  <span className="text-[11px] text-[#A9B5AE] font-semibold">
                    Built for someone who trains{' '}
                    {ACTIVITY_LEVELS.find((a) => a.value === form.activity_level)?.hint
                      ?.toLowerCase() ?? 'regularly'}
                  </span>
                </div>

                <div className="no-print px-6 md:px-9 pb-5">
                  <WeekTracker days={trainingDays} matrix={plan.training_matrix}
                    done={progress.done} onReset={progress.reset} />
                </div>

                <SessionBoard days={trainingDays} matrix={plan.training_matrix}
                  done={progress.done} onToggle={progress.toggle} />

                <TrainingGuide />
              </div>
            </section>

            {/* projection */}
            <section className="mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9 print-break">
              <ProjectionChart startKg={startKg} tdee={plan.metrics.tdee}
                target={calories} units={units} />
            </section>

            {(plan.assumptions?.length > 0 || plan.reference_guidance) && (
              <section className="mt-6 bg-white rounded-2xl border border-[#E3E1DA] p-6 md:p-9">
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

            <ClosingNote />
          </div>
        )}

        {/* ---------------------------------------------------------- footer */}
        <footer className="border-t border-[#E3E1DA] py-10">
          <div className="flex items-center gap-2.5 mb-5">
            <Mark className="w-5 h-5 text-[#141815]" />
            <span className="text-[13px] font-extrabold">OptiFit</span>
          </div>
          <p className="text-[13px] text-[#454B47] font-semibold leading-relaxed max-w-[680px]">
            Built by a sprinter who thinks fitness is the one currency you cannot borrow.
          </p>
          <p className="text-[11px] text-[#9DA29E] leading-relaxed max-w-[680px] mt-3">
            Nothing drastic. If a change feels like too much, talk to a doctor or a
            registered dietitian.
            {profileId && <span className="no-print"> Your plan stays at this link.</span>}
          </p>
        </footer>
      </div>
    </div>
  );
}