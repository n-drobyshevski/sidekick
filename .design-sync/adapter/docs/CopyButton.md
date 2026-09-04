---
category: Code
---

# CopyButton

Copies what getText returns. getText is a function rather than a string so the button can sit beside content that changes without being rebuilt and losing focus. title becomes the accessible name, answering "copy WHAT".

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `getText` | `() => string` | yes |  |
| `label` | `string` | — | Default "Copy". |
| `copiedLabel` | `string` | — | Default "Copied". |
| `title` | `string` | — | The accessible name - says what is being copied. |

## Usage

```jsx
<CopyButton getText={() => "CVE-2024-3094"} title="Copy the CVE identifier" />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.copy-btn`

> Source: `gas_shared/ui/code.js` → `copyButton()`.
