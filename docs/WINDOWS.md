# Running MacNutriLogger 24/7 on a Windows laptop

Result: the server starts by itself at boot, the laptop never sleeps (even with the lid closed, while plugged in),
and your phone reaches the app at a private `https://<laptop>.<tailnet>.ts.net` address. Nothing is exposed to the
public internet and you don't need a domain or any router/dorm-network changes. Total cost: free.

Why Tailscale: the app needs HTTPS (to install on your phone and work offline). Tailscale gives the laptop a stable
HTTPS address that only your own signed-in devices can open. The server itself only listens on the laptop (127.0.0.1).

## One-time setup (about 10 minutes)

1. **Install Git** (open PowerShell): `winget install --id Git.Git -e`  then close and reopen PowerShell.
2. **Get the code**
   ```powershell
   cd $HOME
   git clone -b claude/mcmaster-nutrition-tracker-e5aev9 https://github.com/rockyyu000-commits-goo/MacNutriLogger
   cd MacNutriLogger
   ```
   (Git will open a browser window to sign in to GitHub if the repo is private.)
3. **Run the setup script as Administrator**: Start menu -> type PowerShell -> right-click -> Run as administrator, then:
   ```powershell
   cd $HOME\MacNutriLogger
   Set-ExecutionPolicy -Scope Process Bypass -Force
   .\scripts\windows\setup.ps1
   ```
   It installs Node.js and Tailscale, creates your admin token (printed once; also in `data\.env`), registers an
   auto-start task, turns off sleep, and starts the server. It should end with `Server check: HTTP 200`.
4. **Tailscale**: open Tailscale from the Start menu and sign in (Google/Microsoft/GitHub account is fine).
   - In the Tailscale admin console (login.tailscale.com/admin/dns) click **Enable HTTPS** once.
   - In a normal PowerShell: `tailscale serve --bg 3000`  -> it prints your `https://....ts.net` address.
5. **Phone**: install the Tailscale app, sign in to the same account, open that address in your browser, then
   "Add to Home Screen". Admin page: `<address>/admin.html` with the token from step 3.

Check it works: restart the laptop, wait a minute, open the address on your phone.

## Everyday use
- **Update** (new menus/chains I push): `cd $HOME\MacNutriLogger; .\scripts\windows\update.ps1`
- **Logs**: `data\server.log`. **Status**: Task Scheduler -> `MacNutriLogger`.
- **Back up your edits**: `.\scripts\windows\backup.ps1` (your food log lives in your phone's browser, not on the laptop).
- **Refresh McMaster menus**: run your scraper to produce a CSV, then `node scripts\import-csv.js menu.csv`
  (hand-edited items are kept). The old built-in live scraper does not work: the McMaster page loads item nutrition
  through script callbacks, so it needs a different approach.
- Windows Update may restart the laptop overnight; the server comes back by itself.

## Notes
- Keep the laptop plugged in and in a spot with Wi-Fi. If the dorm Wi-Fi needs a login page (captive portal), the laptop
  must be signed in to it; wired Ethernet is more reliable if you can.
- The server only accepts connections from the laptop itself. To open it on your LAN anyway, set `HOST=0.0.0.0` in `data\.env`.
- To make the address public (anyone with the link), `tailscale funnel` exists, but don't: the admin token is the only lock.
