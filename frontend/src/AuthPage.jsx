import React, { useState } from 'react';
import { describeAuthError, useAuth } from './lib/auth';

const QUOTE = {
  text: 'Let food be thy medicine and medicine be thy food.',
  who: 'Hippocrates',
};

function Mark({ className = '' }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="2" y="5" width="24" height="5" rx="2.5" fill="#FF5A1F" />
      <rect x="2" y="12" width="17" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="2" y="19" width="10" height="5" rx="2.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const inputClass =
  'w-full bg-white border border-[#D9D6CD] rounded-lg px-3.5 py-3 text-[15px] ' +
  'outline-none transition-colors hover:border-[#B9B5AA] focus:border-[#10231F]';

/**
 * mode: 'signin' | 'signup'
 * onDone: called after a successful sign-in, to return to the app.
 * onSkip: lets people use the calculator without an account.
 */
export default function AuthPage({ initialMode = 'signin', onDone, onSkip }) {
  const { signInWithEmail, signUpWithEmail, resendConfirmation, sendPasswordReset,
          authConfigured } = useAuth();

  const [mode, setMode] = useState(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState('');       // '', 'email', 'reset'
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const isSignup = mode === 'signup';

  const submit = async (e) => {
    e.preventDefault();
    // The browser's "required" accepts a name made only of spaces.
    if (isSignup && !fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    setError(''); setNotice(''); setBusy('email');
    try {
      if (isSignup) {
        const { needsConfirmation } = await signUpWithEmail(email, password, fullName);
        if (needsConfirmation) {
          setPendingConfirm(true);
          setNotice(`We sent a confirmation link to ${email}. Check your spam folder too. Once you confirm, sign in and we will greet you by name.`);
          return;
        }
      } else {
        await signInWithEmail(email, password);
      }
      onDone?.();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy('');
    }
  };

  const resend = async () => {
    setError(''); setBusy('resend');
    try {
      await resendConfirmation(email);
      setNotice(`Sent again to ${email}. It can take a minute to arrive.`);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    if (!email) {
      setError('Type your email address first, then tap this again.');
      return;
    }
    setError(''); setBusy('reset');
    try {
      await sendPasswordReset(email);
      setNotice(`If an account exists for ${email}, a reset link is on its way.`);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">

      {/* ------------------------------------------------- left: brand panel */}
      <div className="pine-grid pine-grid-drift text-[#F6F5F2] px-6 md:px-12 py-10 md:py-14
                      flex flex-col justify-between min-h-[260px] md:min-h-screen">
        <button onClick={onSkip} className="flex items-center gap-2.5 self-start group"
          aria-label="OptiFit home">
          <Mark className="w-7 h-7 text-[#F6F5F2] transition-transform group-hover:scale-105" />
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">OptiFit</span>
        </button>

        <div className="hidden md:block max-w-[420px] py-14">
          <h2 className="text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] balance">
            Keep every plan in one place.
          </h2>
          <ul className="mt-8 space-y-4">
            {[
              'Your plans saved to your account, not just this browser',
              'Tick off sessions on your phone and see it on your laptop',
              'Come back next month and compare against your old numbers',
            ].map((line) => (
              <li key={line} className="flex gap-3 text-[14px] text-[#A9B5AE] leading-relaxed">
                <span className="text-[#FF5A1F] font-extrabold mt-px">&rarr;</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <figure className="hidden md:block">
          <blockquote className="text-[15px] text-[#A9B5AE] leading-relaxed max-w-[360px]">
            {QUOTE.text}
          </blockquote>
          <figcaption className="text-[12px] font-bold text-[#7E8C85] mt-2.5">
            {QUOTE.who}
          </figcaption>
        </figure>
      </div>

      {/* ------------------------------------------------------- right: form */}
      <div className="bg-[#F6F5F2] px-6 md:px-12 py-12 md:py-14 flex items-center">
        <div className="w-full max-w-[400px] mx-auto">

          <h1 className="text-[28px] font-extrabold tracking-[-0.025em] leading-tight">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-[13.5px] text-[#6E756F] mt-2.5 leading-relaxed">
            {isSignup
              ? 'So your plans and your training week follow you between devices.'
              : 'Sign in to pick up where you left off.'}
          </p>

          {!authConfigured && (
            <p className="mt-6 text-[13px] text-[#A8521C] bg-[#FDF5EE] border border-[#E8D5C2]
                          rounded-lg p-4 leading-relaxed">
              Accounts are not switched on yet. Add your Supabase keys to
              <code className="mx-1 font-bold">.env.local</code>
              and restart the dev server.
            </p>
          )}

          <form onSubmit={submit} className="mt-8 space-y-4">
            {isSignup && (
              <div>
                <label htmlFor="fullName" className="block text-[12px] font-bold mb-1.5">
                  Your name
                </label>
                <input id="fullName" type="text" required autoComplete="name"
                  maxLength={60}
                  value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Johnson" className={inputClass}
                  disabled={!authConfigured || Boolean(busy)} />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-[12px] font-bold mb-1.5">
                Email address
              </label>
              <input id="email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" className={inputClass}
                disabled={!authConfigured || Boolean(busy)} />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor="password" className="text-[12px] font-bold">Password</label>
                <button type="button" onClick={() => setShowPassword((s) => !s)}
                  className="text-[11px] font-bold text-[#6E756F] hover:text-[#141815]">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input id="password" type={showPassword ? 'text' : 'password'} required
                minLength={8}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? 'At least 8 characters' : ''}
                className={inputClass}
                disabled={!authConfigured || Boolean(busy)} />
              {isSignup && (
                <p className="text-[11px] text-[#6E756F] mt-1.5">
                  Eight characters minimum. Three random words you will actually
                  remember beat one clever word with symbols in it.
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="text-[13px] text-[#A8521C] border-l-2 border-[#A8521C] pl-3 leading-relaxed">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-[13px] text-[#2F6F5E] border-l-2 border-[#2F6F5E] pl-3 leading-relaxed">
                {notice}
              </p>
            )}
            {pendingConfirm && isSignup && (
              <button type="button" onClick={resend} disabled={Boolean(busy)}
                className="text-[12.5px] font-bold text-[#FF5A1F] hover:underline disabled:opacity-50">
                {busy === 'resend' ? 'Sending' : 'Did not get it? Resend the email'}
              </button>
            )}

            <button type="submit" disabled={!authConfigured || Boolean(busy)}
              className="w-full flex items-center justify-center gap-2 bg-[#10231F] hover:bg-[#17352D]
                         disabled:bg-[#A9B5AE] text-[#F6F5F2] text-[14px] font-bold py-3.5
                         rounded-lg transition-colors">
              {busy === 'email' && <Spinner />}
              {isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {!isSignup && (
            <button type="button" onClick={reset} disabled={!authConfigured || Boolean(busy)}
              className="mt-4 text-[12.5px] font-bold text-[#6E756F] hover:text-[#141815]">
              Forgot your password?
            </button>
          )}

          <p className="text-[13px] text-[#6E756F] mt-8">
            {isSignup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button"
              onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); setNotice(''); setPendingConfirm(false); }}
              className="font-bold text-[#FF5A1F] hover:underline">
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <div className="mt-8 pt-6 border-t border-[#E3E1DA]">
            <button type="button" onClick={onSkip}
              className="text-[13px] font-bold text-[#6E756F] hover:text-[#141815]">
              Skip for now and just build a plan
            </button>
            <p className="text-[11px] text-[#9DA29E] mt-2 leading-relaxed">
              You can use everything without an account. Signing in only means your
              plans are kept for you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}