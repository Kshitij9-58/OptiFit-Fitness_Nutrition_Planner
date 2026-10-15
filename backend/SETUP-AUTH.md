# Setting up accounts

Follow these in order. Nothing here needs code changes, only settings in two
or three web dashboards plus two environment files.

Time: about 20 minutes for email and Google. Apple is longer and costs money.

---

## Where the files go

| File | Goes to |
|---|---|
| `auth.jsx` | `frontend/src/lib/auth.jsx` (create the `lib` folder) |
| `AuthPage.jsx` | `frontend/src/AuthPage.jsx` |
| `main.jsx` | `frontend/src/main.jsx` (replaces yours) |
| `App.jsx` | `frontend/src/App.jsx` (replaces yours) |
| `backend_auth.py` | `backend/app/auth.py` (note the rename) |
| `models.py` | `backend/app/models.py` (replaces yours) |
| `main.py` | `backend/app/main.py` (replaces yours) |
| `schemas.py` | `backend/app/schemas.py` (replaces yours) |

Install the two new packages:

```powershell
cd C:\Users\imksh\OptiFit_Project\frontend
npm install @supabase/supabase-js

cd ..\backend
.\venv\Scripts\Activate.ps1
pip install "pyjwt[crypto]"
pip freeze > requirements.txt
```

Your local SQLite file does not have the new columns, so delete it once. This
loses local test plans only:

```powershell
Remove-Item .\optifit.db -ErrorAction SilentlyContinue
```

---

## Step 1: Create the Supabase project

1. Go to supabase.com and sign up. The free tier is enough.
2. **New project**. Pick any name. Choose a region near you. Set a database
   password and save it somewhere; you will not need it often but losing it is
   annoying.
3. Wait about two minutes while it provisions.

Then collect three values from **Project Settings**:

- **API** section: the **Project URL** and the **anon public** key.
- **API** section, further down: the **JWT Secret**. If your project shows
  signing keys instead of a single secret, skip it; the backend will use the
  public JWKS endpoint automatically.

> The **anon key** is safe in the browser. It is designed to be public. The
> **JWT secret** and the **service role key** are not: those stay on the server
> and must never appear in frontend code or in Git.

---

## Step 2: Point the app at Supabase

**`frontend/.env.local`** (add to what is already there):

```
VITE_API_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

**`backend/.env`** or your shell, for local development:

```
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_JWT_SECRET=your-jwt-secret-if-your-project-has-one
```

In PowerShell for one session:

```powershell
$env:SUPABASE_URL="https://yourproject.supabase.co"
$env:SUPABASE_JWT_SECRET="your-jwt-secret"
uvicorn app.main:app --reload
```

Restart both servers. Visit `http://127.0.0.1:8000/health` and check that
`auth_enabled` reads `true`.

Email sign-up should now work. Try it before touching Google.

> Supabase sends a confirmation email by default. On the free tier those come
> from a shared address and are rate-limited, so they can be slow. For testing,
> **Authentication → Providers → Email** has a toggle to turn off confirmation.
> Turn it back on before anyone real uses the app.

---

## Step 3: Google sign-in

In Supabase, **Authentication → Providers → Google** and copy the **Callback
URL** it shows you. It looks like
`https://yourproject.supabase.co/auth/v1/callback`.

Then in Google Cloud Console (console.cloud.google.com):

1. Create a project, or pick an existing one.
2. **APIs & Services → OAuth consent screen**. Choose **External**. Fill in app
   name, your email as support contact, and your email under developer contact.
   Save. You can leave it in Testing mode while developing; add your own Google
   account under **Test users**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - **Authorised JavaScript origins**: `http://localhost:5173` and your Vercel
     URL
   - **Authorised redirect URIs**: the Supabase callback URL from above
4. Copy the **Client ID** and **Client secret**.

Back in Supabase, paste both into the Google provider and enable it.

Test it. If you get `redirect_uri_mismatch`, the redirect URI in Google does not
exactly match Supabase's callback. It is case-sensitive and the trailing slash
matters.

---

## Step 4: Apple sign-in (optional, costs money)

Apple requires the **Apple Developer Program at $99 a year**. Everything else
here is free. Skip this section if you would rather not pay; the button will
show an error if tapped, or you can delete it from `AuthPage.jsx`.

At developer.apple.com, under **Certificates, Identifiers & Profiles**:

1. **Identifiers → +** → **App IDs** → **App**. Give it a bundle id such as
   `com.yourname.optifit`. Enable **Sign In with Apple**.
2. **Identifiers → +** → **Services IDs**. Identifier such as
   `com.yourname.optifit.web`. This is your **Client ID** for the web.
3. Edit that Services ID, enable **Sign In with Apple**, **Configure**:
   - Primary App ID: the App ID from step 1
   - Domains: `yourproject.supabase.co`
   - Return URLs: `https://yourproject.supabase.co/auth/v1/callback`
4. **Keys → +**. Enable **Sign In with Apple**, pick the App ID, register, and
   download the `.p8` file. **You can only download it once.** Note the **Key
   ID** and your **Team ID** (top right of the portal).

In Supabase, **Authentication → Providers → Apple**, enter the Services ID as
the client id, plus the Team ID, Key ID, and the contents of the `.p8` file.
Enable it.

> Apple only sends the user's name on the very first sign-in, and users can
> choose to hide their real email behind a relay address. This is normal and
> not a bug in your app.

---

## Step 5: Redirect URLs

In Supabase, **Authentication → URL Configuration**:

- **Site URL**: your production URL, e.g. `https://optifit.vercel.app`
- **Redirect URLs**: add `http://localhost:5173/**` and
  `https://optifit.vercel.app/**`

Without these, OAuth will complete and then bounce the user somewhere wrong.

---

## Step 6: Production

**Render** → your service → **Environment**:

```
SUPABASE_URL            = https://yourproject.supabase.co
SUPABASE_JWT_SECRET     = your-jwt-secret
OPTIFIT_ALLOWED_ORIGINS = https://optifit.vercel.app
OPTIFIT_COACH_PROVIDER  = none
```

**Vercel** → Settings → Environment Variables:

```
VITE_API_URL           = https://your-render-url.onrender.com
VITE_SUPABASE_URL      = https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGciOi...
```

Redeploy Vercel after adding them; environment changes do not apply to an
existing build.

---

## Still outstanding: the database

Accounts now exist, but your plans still live in SQLite on Render's disk, which
is wiped on every deploy. The accounts survive because Supabase holds them, but
the plans attached to them will not.

Supabase gives you a Postgres database with the project you just made. Switching
to it is a connection-string change:

```python
# backend/app/database.py
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./optifit.db")
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {},
)
```

Then set `DATABASE_URL` in Render to the connection string from Supabase under
**Project Settings → Database → Connection string → URI**, and
`pip install psycopg2-binary`. Use the pooled connection string, not the direct
one, since Render's free tier opens and closes connections frequently.

Do this before showing the app to anyone, or their saved plans will disappear
on your next deploy.

---

## Checking it works

1. `/health` shows `auth_enabled: true`
2. Sign up with email, confirm, and the header shows your initial and address
3. Build a plan while signed in, then open it in a private window: the plan
   loads from its link, but ticking a session fails with 403, because it belongs
   to your account
4. Sign out, build a plan anonymously, then sign in: the plan is still usable
5. Sign in on a second browser and your ticked sessions are already there
