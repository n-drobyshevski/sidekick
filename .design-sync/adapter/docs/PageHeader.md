---
category: Controls
---

# PageHeader

The shared page header: a borderless grid closed by a hairline, reading in three levels rather than as a row of equal tiles. hero is the subject, aside is the one thing that qualifies it, stats are the supporting facts. Every slot is optional.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `hero` | `React.ReactNode` | — | The subject - normally a HeroStat. |
| `aside` | `React.ReactNode` | — | The one thing that qualifies the hero. |
| `stats` | `React.ReactNode` | — | Supporting facts - a strip of StatRow. |

## Usage

```jsx
<PageHeader
  hero={<HeroStat label="Median time to remediate" value="18.4 days" sub="1,284 findings closed" />}
  aside={<SevSegmentBar counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }} label="Open findings by severity" />}
  stats={
    <>
      <StatRow name="SAST" value="412" sub="open" />
      <StatRow name="SCA" value="318" sub="open" />
      <StatRow name="Secrets" value="843" sub="open" />
    </>
  }
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.page-header`
- `.page-header--solo`
- `.stat-list`

> Source: `gas_devsecops/src/client/js/ui/controls.js` → `pageHeader()`.
