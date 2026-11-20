# Engineering standards

> Moved from `AGENTS.md` §4 and §6–§9 on 18 Nov 2026. Text unchanged except §5 (data routing), which the backend mandate replaces; see `docs/architecture/ARCHITECTURE.md`.

## 4. CODING STANDARDS, PERFORMANCE & UI PRINCIPLES
**Prefer:** Pure functions, reusable modules, `async/await`, early returns, descriptive variable names.
**Avoid:** Nested callbacks, duplicated code, global state, inline styles, magic numbers.

**Performance & UI Polish Standards:**
- **Never block the UI thread:** Avoid polling when WebSockets exist; batch DOM updates and avoid allocations inside animation loops.
- **Geometry & Hierarchy:** Flatten nested cards stuck inside cards. Ensure mathematical container alignment: **Inner Corner Radius = Outer Corner Radius - Padding**.
- **Data Display:** Enforce tabular numbers (`font-variant-numeric: tabular-nums`) across all financial tables, screeners, and chart legends. Always provide explicit loading states for asynchronous data fetches.
- **Anti-Glitz & Anti-Slop Rule:** Kill meaningless gradients, glowing blurs, forever-looping animations, and decorative filler badges that convey no real operational status. Keep animations strictly tied to useful feedback.
- **Interactive Control Audit:** Every button, link, and tab must be fully wired up. **Zero dead-end links, placeholder `#` buttons, or non-functional fake controls are permitted.**
- **Comprehensive State Coverage:** Every view and component must explicitly handle:
  1. **Empty States** (clean placeholders when datasets have zero records).
  2. **Loading States** (skeleton loaders / spinners during async resolution).
  3. **Error States** (actionable, human-readable error banners).
  4. **Text Truncation & Wrapping** (`text-overflow: ellipsis` or strict multi-line wrapping to prevent layout breakage).
- **Design Inspiration Benchmarks:** Emulate industry-best design references for craft and experience:
  - **UI Design & Speed:** Model the precision, typography, responsiveness, and dark-mode elegance after **Linear**.
  - **Animations & Micro-interactions:** Model the buttery-smooth, purposeful transitions and feel after **Apple**.
  - **Onboarding & Friction Reduction:** Model the streamlined, zero-bloat, direct-to-value progression after **Duolingo**.
- **Forbidden Libraries:** Do not introduce jQuery, Bootstrap, Tailwind, React, Vue, or Angular unless explicitly requested.

---

## 6. SECURITY, PRIVACY & COMPLIANCE HARDENING
- **Secrets & Storage Security:** Never expose API keys or credentials in client bundles. Ensure storage buckets are strictly private (never public) and all user uploads are promptly purged when deleted. Check Git history to ensure no secrets were ever leaked.
- **Database & Query Protection:**
  - **Client vs. Server Keys:** Never use database admin/service-role keys on the frontend; use strictly public anon keys client-side.
  - **Row-Level Security (RLS):** Enforce Row-Level Security on every single database table.
  - **IDOR Prevention:** Perform rigorous server-side ownership verification on all requests to prevent Insecure Direct Object Reference exploits (ensuring a user can only access records matching their verified account ID).
  - **Parameterized Queries:** Always use parameterized queries / prepared statements for all database interactions to prevent SQL injection.
- **API & Billing Protection:** Set strict hard billing caps and usage alerts on all external APIs (Twelve Data, Cloudflare, database providers) to protect against runaway loops or abuse.
- **Route Protection & Sanitization:** Enforce strict authentication on sensitive backend handlers, validate CORS headers, and sanitize all form inputs against XSS.
- **Compliance & AI Disclosures:** Platform documentation and privacy terms must explicitly state that user data is processed through AI third-party integrations to maintain regulatory compliance.

---

## 7. SEO, METADATA & PRODUCTION HYGIENE
- **Metadata & Branding:** Ensure every page features a unique title, meta description, Open Graph / social share preview image (`og:image`), canonical URL, clean custom favicon, and a proper semantic heading hierarchy (`h1`–`h3`). Strip all default Vite/React/preview branding.
- **Discovery & Error Pages:** Include a valid `sitemap.xml`, `robots.txt`, and a custom branded `404` error page.
- **Code Hygiene:** Strip all leftover `console.log` statements, development debug files, and bloated JavaScript build artifacts prior to deployment.

---

## 8. DEPLOYMENT, TESTING & GIT WORKFLOW
**Deploy Targets:** Cloudflare Pages & Cloudflare Workers. Never introduce dependencies incompatible with Cloudflare Workers.

**Before committing, run:**
- `bun install`
- `bun test`
- `bun run dev`
- `bun run build`

**Commit Message Prefixes:**
- `feat:` (New features or modular extractions)
- `fix:` (Bug fixes or fallback corrections)
- `refactor:` (Code cleanup without behavior changes)
- `docs:` (Documentation & `.md` updates)
- `test:` (Playwright test additions/fixes)

---

## 9. AGENT WORKFLOW & UNCERTAINTY PROTOCOL
**Before making changes:**
1. Read relevant files completely.
2. Search for existing implementations.
3. Reuse existing utilities.
4. Avoid duplicate functionality.
5. Make the smallest possible change.
6. Verify no existing behavior changed.
7. Run tests.
8. Update documentation if behavior changed.

**Cross-Agent Validation:** Never rely solely on self-review; cross-verify critical security changes and data pipelines using multi-agent code checks before merging.

**When uncertain:**
- Prefer refactoring over rewriting.
- Prefer extracting modules over modifying legacy code.
- Ask for clarification before deleting functionality.

---

