# U-XX: <area> — plan template

Status: plan for a future PR. No implementation started. Update this header with
the date and the loop round that produced it.

## Why

What user problem this solves and why it is next. Link the roadmap entry.

## Current implementation

What exists today, with file references and the limits that motivate the work.

## Researched best practice

- <Product 1>: what it does well, with links.
- <Product 2>: …
- The shared pattern and what "excellent" means for this area.

## Comparison

| Capability | TaCos today | Reference A | Reference B | … |
| --- | --- | --- | --- | --- |

Call out the few gaps that matter; do not list every feature.

## Gaps, in priority order

1. …
2. …

## Candidate scope (one PR, commits)

Default to one PR, split only if the owner agrees. Each commit is a coherent
slice and can be reviewed independently.

1. Data model / engine.
2. UI / UX.
3. Integration with existing areas.
4. Docs, checks, screenshots.

## Acceptance criteria

Numbered, testable statements. "Done" needs evidence from outside the author:
a check script, build, or a real flow driven end to end.

## Out of scope

List what this PR does not cover, so follow-ups are explicit.

## Open decisions (confirm before coding)

Numbered product choices with a recommendation for each.

## Dependencies

Other plans/PRs that must land first, if any.

## Files likely touched

Paths and short descriptions.

## Checks

New `scripts/check-*.ts` files and existing checks to update; the smoke test;
screenshots if the UI changes. All checks are auto-discovered by
`scripts/check-all.ts`.

## Process

1. This plan is opened as a draft plan PR and reviewed/adjusted.
2. The owner approves the plan and its open decisions.
3. Implementation happens in a separate PR (one item, one commit), referencing
   this document; the plan status is updated at the end.
