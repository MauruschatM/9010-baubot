# Setup

## Getting Started

1. `bun run dev:setup` — this will guide you through Convex project setup
2. Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`
3. `bun run dev`

Your project will be available at:

- **Frontend:** http://localhost:3001

## Better Auth + Convex Setup

Set environment variables from `packages/backend`:

```bash
cd packages/backend
bun convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
bun convex env set SITE_URL http://localhost:3001
```

## Update shadcn/ui (overwrite + add latest)

From the repo root:

```bash
# Overwrite existing UI components and add any newly available ones
bunx --bun shadcn@latest add --cwd apps/web --all --overwrite -y
bun install
```

If you also want to reset the web app to the same preset used by this template before refreshing components:

```bash
rm apps/web/components.json
bunx --bun shadcn@latest create web --cwd apps/web --preset "https://ui.shadcn.com/init?base=base&style=nova&baseColor=neutral&theme=neutral&iconLibrary=remixicon&font=geist&menuAccent=subtle&menuColor=default&radius=default&template=start&rtl=false" --template start -y
bunx --bun shadcn@latest add --cwd apps/web --all --overwrite -y
bun install
```

## Links

- [Better-T-Stack on GitHub](https://github.com/AmanVarshney01/create-better-t-stack)

### Special Sponsors

neondatabase | Guillermo Rauch | Clerk | Novu | Convex
