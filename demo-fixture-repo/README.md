# Demo fixture repo setup

This folder contains a tiny buggy Node app used to run a live, real demo of
the FIXORA pipeline. It has two files on purpose:
- `userGreeting.js` — the buggy file (null-ref on `user.profile.name`)
- `welcomeBanner.js` — a **downstream caller** of `greetUser`, so
  blast-radius analysis has a real caller to detect and a real test
  (`welcomeBanner.test.js`) to run against each candidate fix.

Turn it into an actual git repo FIXORA can operate on:

```bash
# 1. Push sample-buggy-app as its own GitHub repo (or a folder within one)
cd sample-buggy-app
npm init -y
npm install --save-dev jest
# add to package.json: "scripts": { "test": "jest" }

git init
git checkout -b Dev
git add .
git commit -m "initial buggy greeting function"
git remote add origin <your-github-repo-url>
git push -u origin Dev

# 2. Point autofix-bot's .env at this repo
#    LOCAL_REPO_PATH=/path/to/local/clone/sample-buggy-app
#    GITHUB_OWNER=<you>
#    GITHUB_REPO=<repo-name>
#    GITHUB_BASE_BRANCH=Dev

# 3. Confirm the bug is real and the test currently fails:
npx jest
# → userGreeting.test.js fails on the "without a completed profile" case

# 4. Trigger the pipeline (see main README's Demo script section):
curl -X POST http://localhost:3000/demo/trigger \
  -H "Content-Type: application/json" \
  -d "{\"log\": \"$(cat ../sample-error-log.txt | sed 's/"/\\"/g' | tr '\n' ' ')\", \"testCommand\": \"npx jest\"}"
```

Watch Telegram for the live play-by-play, then check the opened PR on GitHub.
