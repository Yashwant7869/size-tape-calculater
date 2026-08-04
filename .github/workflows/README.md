# GitHub Actions Workflows (one-time enable karna hai)

Yeh do workflow files hain, lekin abhi `.github/workflows/` mein nahi hain — kyunki
GitHub Apps ko workflow files push karne ke liye special `workflows` permission
chahiye hoti hai.

## Enable kaise karein (2 minute)

1. GitHub par repo kholo: https://github.com/Yashwant7869/size-tape-calculater
2. Dono files ko **`workflows/` → `.github/workflows/`** mein move karo:
   - Sabse aasaan tareeqa: web UI mein file kholo → **Edit (pencil icon)** →
     filename mein path type karo `.github/workflows/publish.yml` → Commit.
   - Ya locally: `git mv workflows .github-tmp && mkdir -p .github &&
     mv .github-tmp .github/workflows` (ya `mkdir .github; git mv workflows .github/workflows`) — aapke personal account se directly push karne par yeh kaam kar jayega.
3. Move hote hi Actions tab mein dono workflows dikhne lagenge.

## Files

- **`publish.yml`** — GitHub Release banate hi (ya Actions tab se manually)
  npm par auto-publish karta hai. Repo Secrets mein `NPM_TOKEN` add karna hoga
  (npmjs.com → Access Tokens → Granular token with publish permission).
- **`demo.yml`** — `main` branch par push hote hi demo app GitHub Pages par
  deploy karta hai. Pehle repo **Settings → Pages → Source: GitHub Actions**
  select karein.
