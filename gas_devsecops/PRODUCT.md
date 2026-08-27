# PRODUCT — Wiz Sidekick DevSecOps

> Sibling of [`../PRODUCT.md`](../PRODUCT.md). The register, the two desks, the brand
> personality, the anti-references and the five design principles are **inherited
> unchanged**. What differs is stated here. Where this file is silent, the shared document
> governs.

**Register:** `product`

## What differs

### The register is code, not estate

The OS sidekick measures workloads; the AI sidekick measures assets and their posture. This
one measures **findings in source repositories** — three of them, and they are not
interchangeable:

| Scope | The finding | Fixed by | Why its clock differs |
|---|---|---|---|
| `sca` | a CVE in a third-party package at a version | upgrading the dependency | cannot be fixed at all until a fixed version exists, so the wait for a vendor has to be separated from the wait for the team |
| `sast` | a weakness class at a file and line in first-party code | changing the code | no vendor, so no second clock — and no `resolvedAt` either, so the death date comes from the finding disappearing between scans rather than from the API |
| `secrets` | a credential committed to a repository | rotating it | leaving the register means the string is out of HEAD; the credential stays live until it is rotated |

That table is the reason the three are three pages rather than one list under a filter.

### A sixth design principle: **a clock has to say where it started**

The five shared principles hold. This register adds one, because its central number is a
duration and a duration is only as honest as its origin.

Every remediation figure here states what it measured from and what it did with the rows it
could not measure. A median over closed findings only is not a median of remediation; it is
a median of the findings that happened to close. The estimator keeps still-open rows as
right-censored observations for that reason, and where the curve never reaches half, the
page publishes a lower bound rather than a number.

The corollaries are specific and each one was a decision:

- **Never a zero that means "unknown".** SAST findings carry a birth date (`createdAt`) but
  no resolution date, and the tenant returns no resolved SAST rows at all. Requesting them
  anyway would make each one open and close in the same instant — a real `mttr_days == 0.0`
  that would drag the median to the floor. So they are not requested. The clock is not lost:
  a finding that stops being returned is dated closed at the scan that noticed, which is an
  observation-bounded estimate and says so. *"No MTTR yet"* is a state a reader can act on;
  *"MTTR is 0 days"* is a confident lie.
- **Waiting for a vendor is not remediation time.** An SCA finding with no published fix is
  reported as awaiting a fix, not as a slow team.
- **Removed is not rotated.** A secret leaving the register is one event; the credential
  being dead is another. Two dates, because they are two facts.
- **Absent is never zero.** Wiz returns `null` for a signal it never evaluated. Measured,
  unmeasured and not-applicable are three states and render as three things.

### Accessibility, and what this register's accent costs

The shared bar holds: WCAG 2.1 AA, visible focus on every interactive element, a
`prefers-reduced-motion` alternative for every animation, and severity that never carries
meaning by colour alone.

One addition. The brand accent here is `#ffcb13`, which measures **1.52:1 on white** and
**1.30:1 on the meter track** — it clears no contrast floor on its own. It was chosen with
that known, because it is the only candidate that reads as a real yellow while sitting 21.8
OKLab from the Medium severity fill, so nothing in a chart can be mistaken for a severity.
The price is paid structurally rather than forgiven:

- the accent carries **fills only** — never text, never a focus ring, never a chart series;
- every accent fill carries `--accent-edge` beneath it, which is what lifts it to 3.49:1;
- `--accent-text` (`#7c4a0a`, 7.39:1) carries everything the accent used to;
- the primary button stays graphite, because white on this accent is 1.52:1.

`test/tokens.test.js` holds all four. A later edit that "simplifies" a focus ring back onto
`var(--accent)` would look tidy and would be unreadable.
