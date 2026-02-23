# Tailwind CSS v4 Configuration

**CRITICAL: This project uses Tailwind CSS v4, which has significant differences from v3.**

## PostCSS Configuration

The `postcss.config.mjs` must use the new `@tailwindcss/postcss` plugin:

```js
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
```

**DO NOT** use the old `tailwindcss` package directly as a PostCSS plugin in v4.

## globals.css Structure

Tailwind v4 uses CSS-native configuration instead of `tailwind.config.js`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  /* CSS variables for theming */
  --background: oklch(0.98 0.001 0);
  --foreground: oklch(0.15 0 0);
  --primary: oklch(0.15 0 0);
  --primary-foreground: oklch(0.98 0 0);
  /* ... more color variables */
  --radius: 0.375rem;
}

.dark {
  /* Dark mode overrides */
  --background: oklch(0.12 0 0);
  --foreground: oklch(0.95 0 0);
  /* ... */
}

@theme inline {
  /* Map CSS variables to Tailwind */
  --font-sans: "Geist", "Geist Fallback";
  --font-mono: "Geist Mono", "Geist Mono Fallback";
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* ... */
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: calc(var(--radius) - 1px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

## Key Tailwind v4 Differences

1. **No tailwind.config.js** - Configuration is done in CSS with `@theme` directive
2. **New import syntax** - Use `@import "tailwindcss"` instead of `@tailwind base/components/utilities`
3. **CSS variables** - Colors are defined as CSS custom properties using `oklch()` color space
4. **@theme directive** - Maps CSS variables to Tailwind classes
5. **@custom-variant** - Define custom variants like dark mode

---

## Best Practices

### Design System Approach (Vercel/shadcn Style)

#### Color Palette
- Use semantic color variables: `bg-primary`, `text-foreground`, `border-border`
- Use opacity modifiers for subtle backgrounds: `bg-primary/10`
- Add rings for focus states: `focus:ring-4 focus:ring-ring/50`
- Use `ring-inset` for badges: `ring-1 ring-inset ring-primary/20`

#### Spacing & Layout
- Use consistent spacing: `gap-4`, `gap-6`, `gap-8`
- Container with `max-w-7xl mx-auto` for content
- Padding: `px-4 sm:px-6 lg:px-8` for responsive spacing

#### Typography
- Headings: `text-2xl font-semibold tracking-tight`
- Body: `text-sm text-muted-foreground`
- Labels: `text-xs font-medium`

#### Borders
- Use 1px borders: `border border-border` (not `border-2`)
- Consistent border radius: `rounded-lg` (large), `rounded-md` (medium)

#### Interactive Elements
- Buttons: `h-9` or `h-10` for consistent heights
- Subtle hover: `hover:bg-accent` instead of heavy color changes
- Focus states: `focus-visible:ring-ring/50 focus-visible:ring-[3px]`
- Disabled: `disabled:opacity-50 disabled:cursor-not-allowed`

#### Tables
- Header: `bg-muted border-b border-border`
- Rows: `hover:bg-muted/50 transition-colors`
- Dividers: `divide-y divide-border`

#### Cards & Containers
- White background with subtle border: `bg-card border border-border rounded-xl`
- Shadow only when needed: `shadow-sm` (not heavy shadows)

#### States & Animations
- Smooth transitions: `transition-colors` instead of `transition-all`
- Loading spinners: `animate-spin`
- Opacity transitions: `opacity-0 group-hover:opacity-100`

### Common Mistakes to Avoid
- Don't use gray-XXX -> Use semantic colors: `bg-muted`, `text-muted-foreground`
- Don't use `border-2` -> Use `border` (1px)
- Don't use `shadow-xl` everywhere -> Use `shadow-sm` or no shadow
- Don't use `rounded-xl` for everything -> Use `rounded-lg` for most elements
- Don't add `p-0 m-0` resets -> Tailwind resets by default
- Don't use heavy colors -> Use opacity modifiers `/10`, `/20` for subtle tints

### Example Modern Button
```tsx
// Primary
className="h-10 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"

// Secondary/Outline
className="h-10 px-4 border border-border bg-background text-foreground rounded-lg hover:bg-accent transition-colors"
```

### Example Modern Input
```tsx
className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus:border-ring focus:ring-4 focus:ring-ring/50"
```
