---
category: Inputs
---

# TokenList

A set of values as removable chips with a picker to add more. The picker is built ONCE and only the chips are rebuilt - a rebuilt input is a dropped keystroke and focus on body.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `values` | `string[]` | yes |  |
| `options` | `Array<string \| Option>` | — | Picker rows. |
| `onChange` | `(next: string[]) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `placeholder` | `string` | — | Default "Add…". |
| `emptyText` | `string` | — |  |

## Usage

```jsx
<TokenList
  ariaLabel="Repositories"
  values={["payments-api", "ledger-svc"]}
  options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
  onChange={() => {}}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.token-chips`
- `.token-list`
- `.token-empty`
- `.small`
- `.muted`
- `.token-x`
- `.token`

> Source: `gas_shared/ui/tokenList.js` → `tokenList()`.
