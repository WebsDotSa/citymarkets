# Storybook Deployment Guide

## 📚 What is This?

City Markets Storybook is an interactive component library with 8 design system components and 50+ story variants. It's built with Storybook v10 and Next.js.

**Status:** ✅ Built and ready to deploy  
**Location:** `/storybook-static/` (after `npm run build-storybook`)  
**Size:** ~1.2 MB (optimized static site)

---

## 🚀 Quick Start

### Run Locally (Development)
```bash
npm run storybook
# Opens http://localhost:6006
```

### Build Static Site
```bash
npm run build-storybook
# Output: storybook-static/
```

---

## 📡 Deployment Options

### **Option 1: Vercel (Recommended)**

Fastest and most integrated option.

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd /var/www/citymarkets.sa/city-market-app
vercel --prod --name citymarkets-storybook

# Or create vercel.json:
cat > vercel.json << 'EOF'
{
  "buildCommand": "npm run build-storybook",
  "outputDirectory": "storybook-static",
  "env": {
    "NODE_ENV": "production"
  }
}
EOF

vercel --prod
```

**Result:** `https://citymarkets-storybook.vercel.app`

---

### **Option 2: Netlify**

Free tier with auto-deployments.

```bash
# 1. Connect GitHub repo to Netlify
# https://app.netlify.com/start

# 2. Set build command:
#    Build Command: npm run build-storybook
#    Publish Directory: storybook-static

# 3. Deploy automatically on git push
```

---

### **Option 3: GitHub Pages (Simple)**

Free static hosting via GitHub.

```bash
# 1. Add to package.json scripts:
{
  "scripts": {
    "build-storybook": "storybook build",
    "deploy-storybook": "npm run build-storybook && gh-pages -d storybook-static"
  }
}

# 2. Install gh-pages
npm install --save-dev gh-pages

# 3. Deploy
npm run deploy-storybook

# 4. Enable Pages in GitHub repo settings:
#    Settings → Pages → Source: gh-pages branch
```

**Result:** `https://websdotsa.github.io/citymarkets/`

---

### **Option 4: Docker (Production)**

Deploy as containerized service.

```dockerfile
# Dockerfile.storybook
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build-storybook

FROM nginx:alpine
COPY --from=builder /app/storybook-static /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
# Build and run
docker build -f Dockerfile.storybook -t citymarkets-storybook .
docker run -p 3000:80 citymarkets-storybook
```

---

## 📋 What Gets Deployed

```
storybook-static/
├── index.html          # Main entry point
├── iframe.html         # Story frame
├── preview.js          # Configuration
├── main.*.js           # Main bundle
└── [chunks]/           # Component chunks
    ├── 257.*.js        # PageHeader, Card, Chip
    ├── 609.*.js        # Admin components
    ├── 753.*.js        # Docs addon
    └── ...
```

**Total Size:** ~1.2 MB (gzipped: ~300 KB)

---

## 🔗 Available Stories

### Design System
- **PageHeader** — Page titles with icons (5 variants)
- **Card** — Content containers (4 variants)
- **Chip** — Tags/badges/filters (5 variants)
- **VendorCard** — Vendor display (6 variants)

### Admin Components
- **AdminPageHeader** — Admin headers (4 variants)
- **AdminCard** — Admin wrappers (5 variants)
- **AdminInput** — Form fields (8 variants)
- **AdminButton** — Action buttons (13 variants)

---

## 📝 Accessing After Deployment

Once deployed, team members can:

1. **View Components** — Browse all 50+ story variants
2. **Copy Props** — See exact component props for each variant
3. **Test Interactions** — Click buttons, type in inputs
4. **Check Accessibility** — Run a11y addon tests
5. **Reference Design** — See design tokens in use

---

## 🔄 Keep It Updated

After merging new component stories:

```bash
# Rebuild
npm run build-storybook

# Deploy (choose one from above)
vercel --prod           # Vercel
npm run deploy-storybook # GitHub Pages
# Or use Netlify auto-deploy
```

---

## 🛠️ Troubleshooting

### Build fails with "Cannot find module"
```bash
npm install
npm run build-storybook
```

### Styles not loading
- Check `.storybook/preview.tsx` imports
- Rebuild with `npm run build-storybook --no-cache`

### Stories not appearing
```bash
# Verify stories exist:
ls src/components/**/*.stories.tsx

# Rebuild:
npm run build-storybook
```

---

## 📊 Comparison of Deployment Options

| Option | Cost | Setup Time | CI/CD | Domain |
|--------|------|-----------|-------|--------|
| **Vercel** | Free tier | 2 min | Auto | vercel.app |
| **Netlify** | Free tier | 2 min | Auto | netlify.app |
| **GitHub Pages** | Free | 5 min | Manual | github.io |
| **Docker** | Your infra | 10 min | Manual | Custom |

---

## ✨ Next Steps

1. **Choose deployment method** (Vercel recommended)
2. **Deploy** using option above
3. **Share URL** with team in Slack/email
4. **Keep updated** after new component stories
5. **Gather feedback** from design/dev teams

---

**Questions?** See `.storybook/main.ts` or `package.json` for config details.

Build Date: 2026-10-03  
Storybook Version: 10.6.1  
Status: ✅ Ready for deployment
