# Yu-Gi-Oh! account server

The Flask app serves the frontend and its same-origin authentication API. It connects to SQL Server Express at `.\SQLEXPRESS` using Windows Authentication by default, then creates or verifies the `YUGIOHDB` database and `dbo.Users` table during startup. The schema setup adds `PlayerName` to existing user tables and initializes it from `Username`; newly registered players also start with their account name as their player name.

## Quick start (Windows)

After completing the one-time setup below, run `..\run_project.bat` from the project root (or double-click `run_project.bat`). The script checks or starts SQL Server Express, builds the React frontend, starts Flask in a separate window, and opens the website (normally at `http://127.0.0.1:5000`; it selects the next available port if needed). SQL Server may require administrator permissions to start if its service is stopped.

## Configure

1. Install Python 3.10 or newer and Microsoft ODBC Driver 18 for SQL Server.
2. From this folder, create a virtual environment and install the requirements:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and set a long random `FLASK_SECRET_KEY`. `SQL_AUTH_MODE=windows` uses the Windows account running Flask; that account must be allowed to create the database on first run and create tables/indexes in it.
4. If using SQL Server Authentication instead, set `SQL_AUTH_MODE=sql` and add `SQL_USERNAME` and `SQL_PASSWORD` to the local `.env`. Do not commit `.env`.
5. Start the website from this folder:

   ```powershell
   python app.py
   ```

6. Open `http://localhost:5000`. The login/register page is the entry point; after login, use the start screen to enter the game. The game and duel pages redirect to sign-in when no user is logged in. Set `PORT` in `backend/.env` to use a different available port.

The registration API stores Werkzeug password hashes, not plaintext passwords. Player names are updated in SQL Server through the authenticated profile API, not in browser storage. SQL values are parameterized, and the session cookie is HTTP-only and SameSite=Lax. For local HTTP development, keep `SESSION_COOKIE_SECURE=false`; set it to `true` when serving over HTTPS.
The selected lobby character is stored per account in `dbo.Users.SelectedCharacterId` and loaded from the authenticated session, so the same character appears across browsers. Existing accounts are initialized to Jonouchi when this column is added; changing characters updates the account through `POST /api/profile/character`.
Player wallets are stored in `dbo.Users.Gold` and `dbo.Users.Gems`. Existing accounts receive 103,000 gold and 3,500 gems the first time the schema migration runs, and the lobby loads the current balances from SQL Server. Card ownership is stored per account in `dbo.PlayerCards`, keyed by user and card ID; the card catalog is stored in `backend/data/cards.json` and returned to logged-in clients by `GET /api/cards`. Images, audio, and video are stored in `backend/assets/` and served at public `/assets/...` URLs because the browser needs those files to render and play the game; moving them into the backend does not make them private. Pack inventory shows the remaining copies out of each card's `maxCopies`: it starts at `3/3`, stays in color while copies remain, and turns grayscale at `0/3`.

The authenticated wallet endpoint `POST /api/wallet/exchange` accepts `{ "gems": 100 }`, `{ "gems": 1000 }`, or `{ "gems": 6000 }`, converting those amounts to 1,000, 10,000, or 60,000 gold. The gem deduction and gold credit are committed together in SQL Server, and insufficient balances are rejected without changing either balance.

The authenticated shop endpoints are `GET /api/shop` for wallet, character packs, and owned quantities; `POST /api/shop/purchase` with `{ "pack_id": "kaiba", "pack_count": 1 }` to buy; and `POST /api/shop/reset` with `{ "pack_id": "kaiba" }` to restore that pack to its initial state. Resetting removes the account's owned copies from that character pack; it does not refund spent currency. Supported purchase quantities are 1 pack for 1 gem, 10 for 10 gems, or 50 for 30,000 gold. Wallet deduction and card grants run in one SQL transaction.
