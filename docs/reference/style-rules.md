# Code style

The TypeScript style rules for this repository. They apply to new code, to changes to existing
code, and to `code-cleanup` runs. Formatter and linter configuration own mechanical formatting; a
rule lives here only where tooling cannot enforce it.

## Precedence

[CONSTRAINTS.md](../CONSTRAINTS.md), the reference docs in this directory, and the
[ADRs](../decisions/README.md) override every rule below. Rules must not conflict with one
another: amend or consolidate a conflicting rule rather than working around it, and stop and report
a conflict rather than choosing a side.

Rule IDs are stable, and a retired ID is not reused.

### R-001: Extract modules only for a real boundary

**Rationale:** Modules should represent a reusable or separate concern, not line-count reduction.
**Bad:** Extracting a one-off helper solely to shorten a file.
**Good:** Extracting a pure helper with two callers, a domain concern from a module over roughly 300 lines, or one step of a spec-mandated procedure split out under R-016 when the module is named for that step and has a single caller.
**Enforceable by linter:** no

### R-002: Place modules by dependency direction

**Rationale:** Utility modules must remain independent of domain concerns.
**Bad:** Placing a config-importing port in `app/util/`.
**Good:** Put domain-independent code in `app/util/<concern>.ts` and domain-aware code in `app/<area>/<concern>.ts`.
**Enforceable by linter:** partially

### R-003: Keep module boundaries named and cohesive

**Rationale:** Clear module names and narrow ownership make dependencies understandable.
**Bad:** A collective `dependencies`, `helpers`, `types`, `common`, or `shared` module holding unrelated interfaces.
**Good:** One concern per module, each implementation-oriented interface in its named module, named exports, no barrel files, and no domain imports from `app/util/`.
**Enforceable by linter:** partially

### R-004: Preserve the route's required ordering

**Rationale:** The ingest sequence is a specified invariant; the order must stay readable in one place.
**Bad:** Moving the ingest sequence itself, or the conditions that skip or short-circuit a step, out of `app/main.ts`.
**Good:** Keep `app/main.ts` responsible for its route and for the ingest sequence and its branch points, visible as an ordered series of named calls; a step's internals may live in `app/ingest/<step>.ts`, and interfaces, factories, and record shapes it merely uses move freely.
**Enforceable by linter:** no

### R-005: Document and test every module

**Rationale:** Each module needs explicit ownership and coverage.
**Bad:** Adding a module without its focused test or repository-layout entry.
**Good:** Every module under `app/` has a matching `tests/test_<module>.ts`, and a new module or test is added to the layout in [configuration.md](configuration.md).
**Enforceable by linter:** no

### R-006: Delete reconstructible comments

**Rationale:** Comments should preserve external knowledge, not restate code or spec prose.
**Bad:** A comment that describes the immediately following implementation; a file-top module-header block that summarizes the module or restates its spec section or constraints, even when it cites section or constraint numbers — the repository-layout document already maps each module to its spec.
**Good:** No module-header comment blocks. For any other comment, keep only a spec anchor, numbered constraint, ADR, external-system workaround, or safety boundary, normally on one line.
**Enforceable by linter:** no

### R-007: Fail required invariants explicitly

**Rationale:** Defensive defaults hide corruption and violate established invariants.
**Bad:** Replacing a missing required value with `""`, `0`, or `[]` via `??` or optional chaining.
**Good:** Throw an informative invariant error; use `app/util/assert.ts` helpers for indexed access when appropriate.
**Enforceable by linter:** partially

### R-008: Preserve real absence and recoverable failures

**Rationale:** Required-value checks must not erase valid nullable states or change client-visible failures.
**Bad:** Throwing for a nullable model field or converting a recoverable 400 validation failure into a 500.
**Good:** Keep injected option defaults and spec-required nullable fields, and name the field or constraint that requires the nullable state.
**Enforceable by linter:** no

### R-009: Validate untrusted input at the boundary

**Rationale:** Business logic should work with validated, non-nullable data.
**Bad:** Passing an unchecked HTTP, Firestore, JSON, or environment value downstream with a cast.
**Good:** Use `unknown` plus explicit guards once at the boundary.
**Enforceable by linter:** partially

### R-010: Keep TypeScript strict and explicit

**Rationale:** Types should be strengthened rather than bypassed.
**Bad:** Introducing `any`, non-null assertions, unsafe untrusted-input casts, default exports, `enum`, floating promises, empty catches, thrown strings, reassigned parameters, or `async` without `await`.
**Good:** Give exported functions explicit return types, use discriminated unions and exhaustive `never`, typed error classes, and `.js` relative imports.
**Enforceable by linter:** partially

### R-011: Prefer immutable, named shapes

**Rationale:** Immutable values and explicit shapes reduce accidental state and ambiguity.
**Bad:** A conditional `let` or repeated anonymous object shape.
**Good:** Prefer `const`; express a conditional assignment as a named result object or a control-flow adapter. Use `readonly` for unmutated fields and array parameters, name repeated shapes, and take an options object after three positional parameters.
**Enforceable by linter:** partially

### R-012: Choose TypeScript declarations by intent

**Rationale:** Type declarations should communicate their extension contract.
**Bad:** Using an interface for a union or a type alias for an intended implementation contract.
**Good:** Use `type` for aliases and unions; use `interface` for object shapes designed for implementation or extension.
**Enforceable by linter:** no

### R-013: Preserve persistence and secret boundaries

**Rationale:** Storage contracts and the secret boundary are fixed by the reference docs and the constraints, not by local convenience.
**Bad:** Renaming persisted Firestore snake_case fields or moving `raw_text` beyond its flag-controlled logging path.
**Good:** Preserve the persisted field names in [persistence.md](persistence.md) and never log secrets. Renaming a persisted field is a data migration, not a style change.
**Enforceable by linter:** no

### R-015: Prefer explicit object fields to optional defaults

**Rationale:** A caller should state required intent instead of relying on a hidden default.
**Bad:** Accepting `{ timeoutMs?: number }` and silently substituting a default when every caller must choose a timeout.
**Good:** Require `{ timeoutMs: number }`; make a field optional only when omission genuinely simplifies the API and its default is the clear, intended behavior.
**Enforceable by linter:** no

### R-016: Decompose long sequential procedures

**Rationale:** A long straight-line body hides both its steps and the order they run in.
**Bad:** A route handler that inlines parse, idempotency lookup, persistence, formatting, and the outbound post as one run of statements.
**Good:** Split a function body that runs more than 20 consecutive statements into named steps, so the caller reads as an ordered sequence of step calls and each step is named for the spec step it performs. Count statements, not lines: wrapped call arguments are not a reason to split.
**Enforceable by linter:** partially (`max-statements`; ESLint is not installed here, so this rule is prose-enforced)
