// Empty loading state — the /ai-chat route manages its own hydration and
// the chat section fills its parent via flex. The root loading.tsx has
// `min-h-[60vh]` which would push the chat section below the visible
// viewport on mobile, so we override it here.
export default function Loading() {
  return null;
}
