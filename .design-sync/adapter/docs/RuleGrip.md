---
category: Inputs
---

# RuleGrip

The drag handle for a reorderable rule row.

## Usage

```jsx
<div style={{ width: 360, display: "grid", gap: 4 }}>
  {["Exploitability", "Asset exposure", "Data sensitivity"].map((label) => (
    <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
      <RuleGrip />
      <span>{label}</span>
    </div>
  ))}
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.rule-grip`

> Source: `gas_shared/ui/rowReorder.js` → `ruleGrip()`.
