# Development Notes

This directory contains working papers, implementation plans, engineering
backlogs, and release-attestation notes. These documents support development
and are not end-user documentation.

Working papers may be incomplete and can change as implementation and testing
uncover new requirements. Once a document becomes stable user-facing or
maintainer-facing guidance, move the finalized material to the appropriate
published documentation location and update links to the canonical version.

## Current papers

- `CHECKPOINT-TIMELINE-PRODUCTION.md` — historical production plan for the
  retired timeline UI; the underlying checkpoint machinery now supports the
  Action Journal.
- `CHECKPOINT-TIMELINE-ATTESTATION.md` — retained release evidence for that
  checkpoint machinery.
- `SHORTCOMINGS.md` — repository-wide engineering shortcomings and follow-up work.

Canonical designs that graduate from this directory are published in `wiki/`.
The change-log optimizer and checkpoint storage designs are maintained there.
