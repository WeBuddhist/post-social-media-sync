# Test accounts: what to create (and what not to)

You don't need a new Gmail or a new phone number for each platform. Every platform lets you test with **one real
person's own accounts**: you add test Pages and channels inside them, and each platform's developer "test" mode limits who
can connect your app. Creating extra or fake accounts to get past phone checks is the one thing to avoid. Platforms
link new accounts to existing ones (same phone, device, email patterns) and disable them, and the developer app
behind them can be flagged with them. For a posting tool, that is the worst outcome.

Rules checked in November 2026. Platforms change these often, so trust what their sites show you.

## Try it first without any account

Set `DEMO_MODE=on` (or `demo: true` when embedding) and connect **Demo accounts**: one simulated account per platform,
so you can try connecting, composing, publishing, history, retries, events and webhooks today. Nothing is sent
anywhere. Put `#fail` in a caption to see a permanent failure, `#flaky` to see a temporary one that is retried.

## The plan

**Identity:** one team member's existing accounts, plus their own phone, used once per platform where asked. For
email, use their normal inbox. If a platform needs a *second* account on it, use a plus-address
(`openpecha+x@gmail.com`): it arrives in the same inbox. Don't use virtual or disposable SMS numbers. They are blocked
or get accounts banned.

| Platform | Create | Phone? | While your app is unreviewed |
|---|---|---|---|
| Facebook | Nothing new: your real profile + a **test Page** made from it | Only if Facebook shows a checkpoint; developer signup asks for a phone or a card | App in Development mode; only people with a role on the app can connect |
| Instagram | In the Instagram app: *Add account > Create new account* (same Accounts Center), switch it to **Professional > Business**, link it to the test Page | Not for the added account | Same as Facebook (the account's Page admin needs an app role) |
| Threads | Open Threads with that Instagram account | No | Add the profile as **Threads Tester** and accept in Threads (*Settings > Account > Website permissions > Invites*) |
| YouTube | Nothing new: in your Google account add a **second channel** (Brand Account, up to 100) | No (only for videos over 15 min) | OAuth consent screen in *Testing*, you listed as test user; logins expire after 7 days; uploads stay **private** until the YouTube API audit |
| TikTok | One TikTok account you own (email or Google sign-in usually works without a phone) | Usually not | Add it as a **Sandbox target user** and set the account **Private**: unaudited apps can only post "Only me" videos |
| LinkedIn | Nothing new: your real profile (and the real OpenPecha Page with you as admin) | No | "Share on LinkedIn" + "Sign In with OpenID Connect" are self-serve: you can post to your profile right away. Page posting needs the Community Management API on a **separate** app, approved by LinkedIn |
| X | Your own account, or a second test handle (one phone may verify up to 10 X accounts) | Yes for the developer account | No test mode, posts are real. 2026 pricing is pay-per-use: load a few dollars of credit first (a post is about $0.015; with a link, about $0.20) |
| Bluesky | One test account | **Yes** on bsky.social right now (check: `curl -s https://bsky.social/xrpc/com.atproto.server.describeServer`) | No developer app needed: create an **App password** in Settings. Posts are public: mark the account as a test account and delete test posts |

## In order

1. **Start the server somewhere public.** Instagram photos and Threads media are downloaded from your server, and
   TikTok and some OAuth logins need an HTTPS redirect URI that isn't localhost. A small VPS or a tunnel on a
   domain you control is enough (see the README). Note the redirect URIs on the dashboard's **Setup** tab.
2. **Bluesky** (10 minutes): sign up, create an app password, connect it in the dashboard. That's your first real post.
3. **Meta** (Facebook, Instagram, Threads): register as a Meta developer, create the app (keep it in Development
   mode), create the test Page, add the Instagram test account and link it, and add the Threads use case and Threads Tester.
   Then follow the Meta sections of [PLATFORM_SETUP.md](PLATFORM_SETUP.md).
4. **YouTube**: Google Cloud project, YouTube Data API, consent screen in *Testing* with you as test user, then
   create the second channel and pick it when you connect.
5. **LinkedIn**: developer app linked to the OpenPecha Page, add the two self-serve products, connect your profile.
   Apply for the Community Management API (on a second, new app, with an @openpecha email and a screen recording) only when you need Page posting.
6. **TikTok**: create the developer organization and app (Terms and Privacy Policy pages on your own site), turn on Direct Post,
   create a Sandbox, add your private test account as target user.
7. **X**: developer console, app with OAuth 2.0 *Read and write*, add a little credit.

Teammates use **their own** real accounts: add them to the Meta app (Tester), to the Google test-user list and as
TikTok target users. Don't share passwords.

## When you go live (for other people's accounts)

Meta: App Review plus Business Verification. Google: OAuth verification for the YouTube scopes **and** the YouTube API
audit (videos uploaded before it stay private for good). TikTok: App Review plus the Content Posting audit. LinkedIn:
Community Management approval. X: nothing extra beyond credits. Start these early, since they take days to weeks.
