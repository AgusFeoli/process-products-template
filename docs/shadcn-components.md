# shadcn/ui Components

## Configuration

The `components.json` file configures shadcn/ui:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

## Available Components

The following shadcn/ui components are available in `@/components/ui/`:

| Component | Import | Description |
|-----------|--------|-------------|
| Accordion | `accordion` | Expandable content sections |
| Alert | `alert` | Alert messages |
| AlertDialog | `alert-dialog` | Confirmation dialogs |
| AspectRatio | `aspect-ratio` | Maintain aspect ratios |
| Avatar | `avatar` | User avatars |
| Badge | `badge` | Status badges |
| Breadcrumb | `breadcrumb` | Navigation breadcrumbs |
| Button | `button` | Buttons with variants |
| ButtonGroup | `button-group` | Grouped buttons |
| Calendar | `calendar` | Date picker calendar |
| Card | `card` | Content cards |
| Carousel | `carousel` | Image/content carousel |
| Chart | `chart` | Data visualization |
| Checkbox | `checkbox` | Checkbox inputs |
| Collapsible | `collapsible` | Collapsible sections |
| Command | `command` | Command palette |
| ContextMenu | `context-menu` | Right-click menus |
| Dialog | `dialog` | Modal dialogs |
| Drawer | `drawer` | Side drawer panels |
| DropdownMenu | `dropdown-menu` | Dropdown menus |
| Form | `form` | Form components |
| HoverCard | `hover-card` | Hover preview cards |
| Input | `input` | Text inputs |
| InputGroup | `input-group` | Grouped inputs |
| InputOTP | `input-otp` | OTP verification input |
| Label | `label` | Form labels |
| Menubar | `menubar` | Menu bar navigation |
| NavigationMenu | `navigation-menu` | Navigation menus |
| Pagination | `pagination` | Page navigation |
| Popover | `popover` | Popover content |
| Progress | `progress` | Progress bars |
| RadioGroup | `radio-group` | Radio button groups |
| Resizable | `resizable` | Resizable panels |
| ScrollArea | `scroll-area` | Custom scrollbars |
| Select | `select` | Select dropdowns |
| Separator | `separator` | Visual dividers |
| Sheet | `sheet` | Side panels |
| Sidebar | `sidebar` | App sidebars |
| Skeleton | `skeleton` | Loading skeletons |
| Slider | `slider` | Range sliders |
| Sonner | `sonner` | Toast notifications |
| Spinner | `spinner` | Loading spinners |
| Switch | `switch` | Toggle switches |
| Table | `table` | Data tables |
| Tabs | `tabs` | Tab navigation |
| Textarea | `textarea` | Multiline text inputs |
| Toast | `toast` | Toast notifications |
| Toggle | `toggle` | Toggle buttons |
| ToggleGroup | `toggle-group` | Grouped toggles |
| Tooltip | `tooltip` | Tooltips |
