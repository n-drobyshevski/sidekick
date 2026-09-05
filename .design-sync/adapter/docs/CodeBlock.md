---
category: Code
---

# CodeBlock

A monospaced block for a command, a path or a blob, with an optional label.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | `string` | yes |  |
| `label` | `string` | — |  |
| `maxHeight` | `string` | — |  |

## Usage

```jsx
<CodeBlock label="Reproduce" text={"npm run probe -- --schema\n# copy the OBJECT_FILTERS entry, never infer it"} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.code-block`

> Source: `gas_shared/ui/code.js` → `codeBlock()`.
