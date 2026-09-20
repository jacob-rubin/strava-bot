# Code cleanup style rules

This is the source of truth for cleanup rules. It preserves the durable rules formerly embedded in the cleanup agent. Formatter and linter configuration own mechanical formatting; apply a rule here only when tooling cannot enforce it. A rule never authorizes expanding the parent-provided file set: report a required companion file and stop instead.

## Precedence

`docs/CONSTRAINTS.md`, the reference docs under `docs/reference/`, and ADRs override every rule below. Rules must not conflict with one another. Amend or consolidate a conflicting rule before a later cleanup uses it; an agent that discovers a conflict stops and reports it.

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

**Rationale:** Cleanup must not obscure required request sequencing; the invariant is the ordering, not the file's size.
**Bad:** Moving the ingest sequence itself, or the conditions that skip or short-circuit a step, out of `app/main.ts`.
**Good:** Keep `app/main.ts` responsible for its route and for the ingest sequence and its branch points, visible as an ordered series of named calls; a step's internals may live in `app/ingest/<step>.ts`, and interfaces, factories, and record shapes it merely uses move freely.
**Enforceable by linter:** no

### R-005: Document and test an in-scope extracted module

**Rationale:** Cleanup-created modules need explicit ownership and coverage.
**Bad:** Adding a module without its focused test or repository-layout entry.
**Good:** When the parent explicitly includes every required companion file, add `tests/test_<module>.ts` for every new module, edit existing tests only for moved imports or the extracted module, and amend `docs/reference/configuration.md` for a new module or test.
**Enforceable by linter:** no

### R-006: Delete reconstructible comments

**Rationale:** Comments should preserve external knowledge, not restate code or spec prose.
**Bad:** A comment that describes the immediately following implementation; a file-top module-header block that summarizes the module or restates its spec section or constraints, even when it cites section or constraint numbers — the repository-layout document already maps each module to its spec.
**Good:** Delete module-header comment blocks outright. For any other comment, keep only a spec anchor, numbered constraint, ADR, external-system workaround, or safety boundary, normally on one line.
**Enforceable by linter:** no

### R-007: Fail required invariants explicitly

**Rationale:** Defensive defaults hide corruption and violate established invariants.
**Bad:** Replacing a missing required value with `""`, `0`, or `[]` via `??` or optional chaining.
**Good:** Throw an informative invariant error; use `app/util/assert.ts` helpers for indexed access when appropriate.
**Enforceable by linter:** partially

### R-008: Preserve real absence and recoverable failures

**Rationale:** Required-value checks must not erase valid nullable states or change client-visible failures.
**Bad:** Throwing for a nullable model field or converting a recoverable 400 validation failure into a 500.
**Good:** Keep injected option defaults and spec-required nullable fields; cite the field or constraint in the cleanup report.
**Enforceable by linter:** no

### R-009: Validate untrusted input at the boundary

**Rationale:** Business logic should work with validated, non-nullable data.
**Bad:** Passing an unchecked HTTP, Firestore, JSON, or environment value downstream with a cast.
**Good:** Use `unknown` plus explicit guards once at the boundary.
**Enforceable by linter:** partially

### R-010: Keep TypeScript strict and explicit

**Rationale:** Cleanup should strengthen rather than bypass type safety.
**Bad:** Introducing `any`, non-null assertions, unsafe untrusted-input casts, default exports, `enum`, floating promises, empty catches, thrown strings, reassigned parameters, or `async` without `await`.
**Good:** Give exported functions explicit return types, use discriminated unions and exhaustive `never`, typed error classes, and `.js` relative imports.
**Enforceable by linter:** partially

### R-011: Prefer immutable, named shapes

**Rationale:** Immutable values and explicit shapes reduce accidental state and ambiguity.
**Bad:** A conditional `let` or repeated anonymous object shape.
**Good:** Do not leave `let` in a cleaned file; use a named result object or control-flow adapter, `readonly` for unmutated fields and array parameters, named repeated shapes, and an options object after three positional parameters.
**Enforceable by linter:** partially

### R-012: Choose TypeScript declarations by intent

**Rationale:** Type declarations should communicate their extension contract.
**Bad:** Using an interface for a union or a type alias for an intended implementation contract.
**Good:** Use `type` for aliases and unions; use `interface` for object shapes designed for implementation or extension.
**Enforceable by linter:** no

### R-013: Preserve persistence and secret boundaries

**Rationale:** Cleanup must not alter storage contracts or expand sensitive-data exposure.
**Bad:** Renaming persisted Firestore snake_case fields or moving `raw_text` beyond its flag-controlled logging path.
**Good:** Preserve persisted field names and never log secrets.
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
**Enforceable by linter:** partially (`max-statements`; ESLint is not installed here, so this rule is prose-enforced — do not add ESLint as part of a cleanup)
