# Post from your own computer

You don't need a server that runs all the time. Start Post Sync on your computer when you want to post and stop it
afterwards. A **Cloudflare Tunnel** on a domain you already have gives your computer the same public address every
time. The platforms need that fixed address: their login redirects and the photo downloads (Instagram, Threads) go to it.

## One-time setup

1. **Install** [Node.js](https://nodejs.org) 22 or newer, `cloudflared`, and ideally `ffmpeg` (it checks videos
   and converts images):
   - macOS: `brew install node cloudflared ffmpeg`
   - Windows: `winget install OpenJS.NodeJS.LTS Cloudflare.cloudflared Gyan.FFmpeg`
2. **Get the code** and install it once: `git clone …` then, in that folder, `npm install`.
3. **Create the tunnel** in Cloudflare: *Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared*, name it
   `post-sync`. On the install page, copy the **token** (the long text after `--token`). You don't need to run that
   install command.
4. **Give it an address:** in the tunnel, *Public hostname > Add*: subdomain `social`, domain `drokpo.ai`, service
   type **HTTP**, URL **localhost:3000**. The address is now `https://social.drokpo.ai`.
5. **Settings:** copy `.env.example` to `.env` and set at least:
   ```
   PUBLIC_BASE_URL=https://social.drokpo.ai
   CLOUDFLARE_TUNNEL_TOKEN=<the token from step 3>
   ADMIN_PASSWORD=<a long password for the dashboard>
   ENABLED_PLATFORMS=facebook,instagram,youtube,tiktok,x
   ```
   plus each platform's app keys as you get them (see [PLATFORM_SETUP.md](PLATFORM_SETUP.md)). Register the redirect
   addresses the dashboard's **Setup** tab shows, e.g. `https://social.drokpo.ai/api/oauth/meta/callback`.

## Every time you post

1. In the folder: `npm run local`. When it prints **Post Sync is ready**, open `https://social.drokpo.ai`.
2. Pick the brand, write the post, publish.
3. **Wait until Posts shows every account as published.** Videos take a few minutes, and Instagram and Threads
   download photos from your computer while they post.
4. Press **Ctrl+C**. It waits for anything still publishing, then closes the server and the tunnel. (Ctrl+C twice
   stops right away; those posts are then shown as interrupted.)

## Good to know

- **Scheduled posts only go out while it runs.** A post scheduled for when the computer is off is published the
  next time you start it.
- **Everything lives in the `data` folder** (connected accounts, history, uploads, the encryption secret). Back it
  up and don't delete it, or you'll reconnect every account. Only this computer can post.
- **Videos over 100 MB:** Cloudflare doesn't accept uploads that big through the tunnel. Open
  `http://localhost:3000` on the same computer (Chrome or Firefox) and post from there; connect accounts at the
  `https://` address.
- **Logins that expire if you rarely start it:** Threads and LinkedIn after about 60 days, and YouTube every 7 days
  while your Google app is in test mode. The dashboard tells you when an account needs reconnecting.
- **Keep `.env` private.** It holds your keys and the tunnel token.
- **Windows:** Ctrl+C also reaches the tunnel directly, so wait until Posts shows everything published before
  pressing it.
