#!/bin/bash
set -e

echo "🚀 Deploying City Markets Storybook to Vercel..."
echo ""

# Check if npm packages are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build Storybook
echo "Building Storybook..."
npm run build-storybook

# Deploy to Vercel
echo ""
echo "Deploying to Vercel..."
echo "  • Follow the prompts to authenticate if needed"
echo "  • Project name: citymarkets-storybook"
echo "  • Framework: Other"
echo "  • Root directory: . (current)"
echo ""

npx vercel --prod \
  --name citymarkets-storybook \
  --confirm

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your Storybook is now live at:"
echo "  https://citymarkets-storybook.vercel.app"
echo ""
echo "Next steps:"
echo "  1. Share the URL with your team"
echo "  2. Browse all 50+ component stories"
echo "  3. Copy props from live stories"
echo "  4. Use for design/dev collaboration"
echo ""
echo "Keep it updated:"
echo "  npm run build-storybook && npx vercel --prod"
