---
category: Cells
---

# Absent

The em-dash cell. Absent is not zero - this is what a value that was never measured looks like.

## Usage

```jsx
<table className="data" style={{ width: 420 }}>
  <thead>
    <tr><th>Repository</th><th>Last scan</th><th>Secrets</th></tr>
  </thead>
  <tbody>
    <tr><td>payments-api</td><td>2 hours ago</td><td>12</td></tr>
    <tr><td>ledger-svc</td><td><Absent /></td><td><Absent /></td></tr>
    <tr><td>report-gen</td><td>6 days ago</td><td>0</td></tr>
  </tbody>
</table>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.muted`

> Source: `gas_devsecops/src/client/js/ui/cells.js` → `absent()`.
