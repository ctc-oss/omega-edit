# DFDL-Assisted Binary Editing

This is a workflow for coupling an external Data Format Description Language
(DFDL) processor with Ωedit™, not an implemented semantic-editing endpoint.
The parser supplies structural meaning; Ωedit™ supplies byte reads and edits.
Do not invent `oe parse`, a field-write tool, or a built-in schema adapter.

DFDL describes text and binary representations and supports parsing into a
structured information set (infoset) and unparsing it into native data. Do not
assume a round trip preserves original bytes: defaults and representation
ambiguities can affect the result. A successful parse may also report validation
errors. See the DFDL specification, sections 3.2, 4, and 9.2.8, in the source below.

## Establish a Trustworthy Mapping

Require a parse of the exact immutable input or current candidate snapshot.
Do not apply a parse of the original disk file to an already-edited session.
A structured value tree alone does not establish a field's editable byte span.
Obtain verified spans from the integration or prove them from the format's
layout; stop semantic editing when the mapping is missing or ambiguous.

For each intended change, record this edit plan outside the tool arguments:

- Input identity: path on the correct machine, size, and a content fingerprint,
  plus the candidate/session content that was actually parsed.
- Schema identity and processor configuration, including validation settings.
- Unambiguous field path, including namespaces and repeated-record index.
- Physical location: zero-based byte/bit span, source offset convention,
  field content boundaries, and enclosing record boundaries.
- Representation: encoding, signedness, byte order, bit order, width, padding,
  delimiters, and whether the field is physically represented or computed.
- Expected original bytes, requested logical value, and exact encoded bytes.
- Dependent lengths, counts, offsets, discriminators, checksums, and signatures.
- Post-edit semantic checks and physical ranges that must remain unchanged.

These are planning requirements, not a schema accepted by the current CLI/MCP.
A session id or history count is not a content fingerprint or monotonic revision.
Use exclusive ownership and a stable snapshot; otherwise stop rather than
presenting a read-before-write check as an atomic conditional mutation.

## Choose the Mutation Strategy

### Fixed-width byte-aligned field

Verify the physical width and representation. Encode the new value using a
trusted encoder and check its width. Read and compare the original bytes,
preview an explicit overwrite, then apply and re-read. Preserve all bytes
outside the agreed change set, including dependent fields that need repair.

For the artificial worked fixture in the main skill, version 1 is `0100` and
version 2 is `0200` at offset 4. This is a two-byte little-endian unsigned
integer because the fixture defines it that way. The same numeric values in a
different schema may need different bytes. Do not extrapolate that layout to
an unknown file just because its header looks similar.

### Bit field

The AI patch interface edits bytes, not arbitrary bits. Read the enclosing
bytes, use the schema's bit-order rules and a tested encoder to modify only
the intended bits, and verify all neighboring bits are preserved. Preview and
overwrite the enclosing bytes. Stop if the bit span or bit-order convention
cannot be established; rounding the field to whole bytes is not sufficient.

### Variable-width or layout-changing field

Do not simply insert or delete bytes and assume later offsets remain valid.
Plan dependent counts, lengths, alignment, delimiters, and offsets first.
Where a record/container can be independently encoded, have the external
processor unparse that complete region and replace the verified old region.
An independent encoding must preserve relevant parent context and alignment.
If it cannot, require a larger container or whole-file reconstruction, explicit
authorization for that scope, and bounded physical comparison of the result.

Do not assume a parser/encoder updates checksums, signatures, or references
unless its schema and implementation actually cover those dependencies. Signed
formats require the approved signing process, not merely a byte replacement.

## Validate Both Meaning and Bytes

1. Materialize the edited session to a separate candidate path. If the parser
   cannot consume unsaved session content, parse this candidate, not the input.
2. Reparse using the same schema and settings; check error and warning diagnostics,
   validation results, and full expected consumption, not only the exit code.
3. Confirm the intended logical value and each dependent value. Invalidate old
   maps after every mutation, including an overwrite that changes a discriminator.
4. Reopen the candidate with Ωedit™ and verify its physical bytes and size.
   Compare untouched regions in bounded chunks, using translated output offsets
   when a replacement changes length. Padding or lexical representations may
   change during unparsing even when the structured values remain equal.
5. If either semantic or byte-preservation checks fail, discard the candidate
   or restore the checkpoint and report the failed assertion. Do not publish it.

For very large files, establish the processor's resource limits separately.
Bounded Ωedit™ reads do not make an external whole-file parse memory-bounded.
For partially understood data, retain unknown regions as opaque bytes and
scope validation honestly; do not claim whole-file semantic correctness.

## Source

[DFDL v1.0 specification, GFD-R-P.240](https://daffodil.apache.org/docs/dfdl/)
provides the format and processing semantics. The mapping and preservation
requirements above are this skill's editing discipline, not a promise that a
particular parser exposes such a mapping.
