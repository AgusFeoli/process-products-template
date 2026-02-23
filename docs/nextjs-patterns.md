# Next.js & TypeScript Patterns

## App Router Page Structure

```tsx
// app/page.tsx - Server Component by default
export default function Page() {
  return <div>...</div>
}

// app/client-page/page.tsx - Client Component
'use client'

export default function ClientPage() {
  const [state, setState] = useState()
  return <div>...</div>
}
```

## Dynamic Routes

```tsx
// app/product/[id]/page.tsx
'use client'

import { useParams } from 'next/navigation'

export default function ProductPage() {
  const params = useParams()
  const id = params.id as string
  // ...
}
```

## Layout Pattern

```tsx
// app/layout.tsx
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })
const geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'My App',
  description: 'App description',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Provider>{children}</Provider>
      </body>
    </html>
  )
}
```

## Image Optimization

```tsx
import Image from 'next/image'

<Image
  src="/image.jpg"
  alt="Description"
  fill                    // Fill container
  className="object-cover"
  priority               // Load immediately (above fold)
/>

// Or with fixed dimensions
<Image
  src="/image.jpg"
  alt="Description"
  width={400}
  height={300}
  className="rounded-lg"
/>
```

## Link Component

```tsx
import Link from 'next/link'

<Link href="/products" className="hover:text-primary transition-colors">
  Products
</Link>

// With Button
<Link href="/cart">
  <Button variant="outline">View Cart</Button>
</Link>
```

---

## TypeScript Patterns

### Type Definitions

```tsx
// lib/types.ts
export interface Product {
  id: string
  name: string
  description: string
  price: number
  image: string
  category: string
}

export type CartItem = Product & {
  quantity: number
}
```

### Component Props

```tsx
// Modern pattern using React.ComponentProps
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: 'default' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  asChild?: boolean
}) {
  // ...
}
```

### Generic Components

```tsx
interface ListProps<T> {
  items: T[]
  renderItem: (item: T) => React.ReactNode
}

function List<T>({ items, renderItem }: ListProps<T>) {
  return <ul>{items.map(renderItem)}</ul>
}
```

---

## Common Implementation Patterns

### Responsive Navigation Header

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Header() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold tracking-tight text-primary">
            Logo
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <Link href="/products" className="text-sm font-medium hover:text-primary transition-colors">
              Products
            </Link>
          </nav>

          <button className="md:hidden" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {isOpen && (
          <nav className="md:hidden mt-4 flex flex-col gap-4">
            <Link href="/products" className="text-sm font-medium hover:text-primary">
              Products
            </Link>
          </nav>
        )}
      </div>
    </header>
  )
}
```

### Product Card

```tsx
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Product } from '@/lib/types'

export function ProductCard({ product }: { product: Product }) {
  return (
    <div className="group bg-card rounded-xl border border-border overflow-hidden hover:shadow-lg transition-shadow">
      <div className="aspect-square relative bg-muted">
        <Image
          src={product.image}
          alt={product.name}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <div className="p-4 space-y-2">
        <h3 className="font-semibold">{product.name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-lg font-bold">${product.price.toFixed(2)}</span>
          <Link href={`/product/${product.id}`}>
            <Button size="sm">View Details</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
```

### Loading States

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export function ProductCardSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <Skeleton className="aspect-square" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div>
  )
}
```
