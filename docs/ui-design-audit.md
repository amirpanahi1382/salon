# Flutter UI Design Audit

**Product:** توجه سالن (Salon Attention / Revenue Intelligence)  
**Scope:** Presentation layer only (`apps/mobile`)  
**Phase:** 1 — read-only audit  
**Audit date:** 2026-09-10  
**Authority:** Flutter source in this repository, then product/architecture docs  

This document is the Phase 1 deliverable. It does **not** implement a redesign.

---

## 0. How this audit was produced

Inspected:

- `AGENTS.md` / `agents.md`
- `docs/current-state-system-spec.md`
- `product-strategy.md` (repo root; not `docs/product-strategy.md`)
- `business-model.md`
- `product/mvp.md`
- `domain/domain-model.md`
- `architecture/data-model.md`
- `architecture/architecture.md`
- All Flutter screens, routing, theme, shared widgets, labels, Jalali helpers
- Flutter widget tests that pin visible copy and loading indicators

Code wins when documentation disagrees. Example: `docs/current-state-system-spec.md` says visit delete is not in the Visits UI; `visits_screen.dart` **does** expose delete for non-STAFF.

Existing uncommitted backend/worker files in this working tree are **out of scope** and must stay untouched.

---

## 1. Current state

### 1.1 What the mobile app is today

A Persian-first Flutter client (`apps/mobile`) for a single-salon tenant. It is **not** booking, POS, calendar, or generic CRM. The implemented loop is:

Customer → completed visit (optional sale for OWNER/MANAGER) → intelligence → opportunity → human action (complete / dismiss / send Bale).

Flutter is the only first-party client. Navigation is five tabs plus stacked routes.

### 1.2 Visual identity today

| Token | Current |
| --- | --- |
| Theme | Single **light** Material 3 theme (`AppTheme.light()`). No dark theme. |
| Background | Warm paper beige `#F7F3EF` |
| Surface | Pure white `#FFFFFF` |
| Ink | Warm brown `#2B2420` |
| Accent | Dusty rose/burgundy `#8A4B4B` with soft fill `#F3E4E0` |
| Font | Vazirmatn Regular / Medium / SemiBold (no Display/Bold files) |
| Locale | `fa_IR` on `MaterialApp`; widgets inherit RTL from locale |
| Shape | Cards radius 16 + 1px `#E6DDD6` border; inputs/buttons radius 12; status pills radius 999 |
| Depth | Card elevation 0. Almost no shadows. |
| Loading | Centered `CircularProgressIndicator` (`LoadingView`) |
| Empty | Title + body text, no icon |
| Error | Centered Persian message + retry |

The current look is a **calm light salon notebook**: warm, readable, slightly generic Material. It is not premium-dark, not intelligence-first, and not Zest-inspired.

### 1.3 Architecture of the UI layer

Presentation and screen-local state live in the same files. Business I/O is already in repositories/providers.

| Responsibility | Current owner |
| --- | --- |
| Auth restore, login, register, logout | `AuthController` in `providers.dart` + `auth_screens.dart` |
| Shell / 5-tab navigation | `app_shell.dart` + `app_router.dart` |
| Today | `dashboard_screen.dart` |
| Customers / detail / form / record visit | `customer_screens.dart` (single large file) |
| Import | `customer_import_screen.dart` |
| Visits | `visits_screen.dart` |
| Opportunities + action history | `opportunities_screen.dart` |
| Action buttons + Bale entry | `opportunity_action_bar.dart` |
| Bale composer | `bale_message_composer.dart` |
| Services | `service_screens.dart` |
| Profile | `profile_screen.dart` |
| Shared chrome | `app_widgets.dart` |
| Copy | `labels.dart` |
| Jalali math | `jalali.dart` |
| Jalali month grid | `jalali_date_picker.dart` (used by **record visit only**) |

### 1.4 Navigation (must keep)

Bottom destinations, in order:

1. امروز (`/`)
2. مشتریان (`/customers`)
3. نوبت انجام شده (`/visits`)
4. فرصت‌ها (`/opportunities`)
5. حساب من (`/profile`) — existing product label is **حساب من**, not «پروفایل»

Stacked routes already exist: customer create/edit/import/detail, record visit, services. Do not add destinations.

### 1.5 Data the UI already has (do not invent more)

**Today / summary (`IntelligenceSummary`):**  
`customers`, `newCustomers`, `active`, `returning`, `atRisk`, `inactive`, `reactivationOpportunities`, `customerReturnOpportunities`, `frequent`, `totalRevenue`, `revenueThisUtcMonth`, `reportingTime`.

The dashboard currently **renders only eight** of these (2×4 metric cards). Unused in UI today: `returning`, `customerReturnOpportunities`, `frequent`, `reportingTime`. Using them later is **not** inventing data.

**Opportunities:** `type`, customer name, intelligence `status`, `reason`, `recommendedAction`. Open `OpportunityAction` is joined in the client by `customerId:type`.

**Customer list API:** `id`, `firstName`, `lastName`, `phoneNumber`, timestamps. **No status, no last visit.**

**Customer detail:** identity + `CustomerIntelligence` (status, explanation, behavior metrics, signals, opportunities, revenue) + visit page.

**Visit row:** customer name, service label, amount label, Jalali datetime.

**Salon profile:** `name`, `status`, optional `phone`/`address` (phone/address unused in Profile UI).

---

## 2. Design problems

### 2.1 Hierarchy — the product question is visually weak

`توجه سالن باید کدام سمت بره؟` is present on Today as a `titleMedium` line, then immediately drowned by an **8-cell KPI grid** (total customers, active, at-risk, inactive, reactivation, new, month revenue, total revenue). That is the autogenerated SaaS dashboard the brief forbids.

There is no greeting, no hero insight, no single dominant number. Attention, retention, and revenue are peers of equal visual weight.

The first opportunity in the list is the real “where to look,” but it sits below the fold after eight cards.

### 2.2 Theme — light paper vs target dark premium

The brief asks for charcoal surfaces and a champagne/gold **accent**. The app is warm-white with a burgundy accent. Switching to dark is a theme-layer change only; it will touch every screen because they inherit `ThemeData`.

Risk of over-gold: keep champagne as accent only.

### 2.3 Everything-is-a-card

`AppCard` wraps metrics, opportunities, action history, customer identity, intelligence, revenue, import filename, and profile. Combined with 16px radius and a border on every card, the UI reads as a stack of identical rounded rectangles.

Lists (customers, visits, services) are the exception: they are `ListTile` + `Divider`, which is better for scanning but visually disconnected from the carded screens.

### 2.4 Typography

- One weight cluster: almost everything is w600 headings + 15px body.
- No display/hero style for the attention question or KPIs.
- Numbers on metric cards use `headlineSmall` (22) but sit in small equal cards, so they do not feel like objects.
- Nav labels are 11px w600 — small for Persian.
- Mixed LTR is handled well in several places (`LtrText`, phone/email/amount). Amounts on customer detail revenue use `LtrText`; visit history subtitle concatenates service · amount in one RTL `Text` (amount can render awkwardly).

### 2.5 Color / status language

`StatusBadge` is a color-only pill:

| Status | Treatment |
| --- | --- |
| AT_RISK | amber |
| INACTIVE | red |
| ACTIVE, RETURNING | same green |
| NEW | muted gray (looks unknown) |

No icon, no surface difference. RETURNING vs ACTIVE is indistinguishable. NEW is under-emphasized. Color-only fails accessibility.

Action statuses OPEN / COMPLETED / DISMISSED are plain text. COMPLETED uses the same string as the primary button (`اقدام انجام شد`), so history and CTA collide semantically on screen.

### 2.6 Opportunities feel like records

`OpportunityCard` order today:

1. Customer name  
2. Status pill + type label  
3. Reason  
4. “پیشنهاد: …”  
5. Three equal buttons (done / dismiss / Bale)

The brief wants: opportunity type → why → customer → context → recommended action. Current order is CRM-row, not “thing worth doing.”

The action bar is visually aggressive (`FilledButton` + two `OutlinedButton`s + helper caption) and repeats on every card, including Today.

### 2.7 Customers — scan quality

Rows are name + LTR phone only. That is all the list API provides. Search is a labeled `TextField`, not a calm native search field. Extended FAB + AppBar upload icon compete. Empty state is good copy with two actions.

### 2.8 Customer detail — CRUD, not story

AppBar: title = name, plus **افزودن مشتری**, edit, delete. On a narrow phone with a long Persian name this will overflow / crowd.

Body: identity card (name again + phone) → intelligence card (badge, why, recommendation, **full action bar per opportunity**, signal chips) → revenue card (raw `0.00` strings, UTC footnote) → visit list with leading delete.

Behavior metrics (`daysSinceLastVisit`, `averageReturnIntervalDays`, `visitCount`) exist on `CustomerIntelligence.behavior` but are **not surfaced as numbers** — only inside the English-localized explanation string. Surfacing those integers is allowed; they are existing fields.

Primary action «ثبت مراجعه» is an extended FAB — correct prominence, calendar-ish icon (`event_available`) slightly fights “completed visit, not booking.”

### 2.9 Record completed visit

Copy is correct (`recordVisitHint` explicitly not booking). Layout is default `ListTile`s + Material time picker + Jalali dialog. OWNER/MANAGER sale fields appear below without a distinct visual “this is a sale” grouping. Empty active-services state is already good.

### 2.10 Visits — “what happened” vs filter chrome

Rows already have the right hierarchy (name → service → LTR amount → caption date). Filters are Material `FilterChip`s. **Date filter uses Gregorian `showDatePicker`**, while record-visit uses the custom Jalali picker. Same product, two calendar languages. Count label uses loaded-page length, not a server total (do not invent a total).

### 2.11 Messaging

Composer is a bottom sheet: title, name, provider line, textarea, send, status. Functionally clear. It does not visually sequence Customer → opportunity context → message → Bale. Opportunity type is not shown in the sheet (only passed into the API). Confirmation dialog copy is strong; keep it.

Default draft text in `defaultBaleMessage` includes a flower emoji. Changing that string would change outbound message content — **out of scope** for UI chrome. Do not restyle by rewriting the template.

### 2.12 Auth

Login already leads with product name + attention question — good bones, sparse execution. No max-width on desktop; fields span the full window. Register AppBar has no `SafeArea` on the body list (AppBar covers it, but landscape/desktop insets are uneven). Splash is a full-screen spinner.

### 2.13 Loading / empty / error

- Full-screen spinner whenever `_loading` and no cached data.
- Pagination footer is a small spinner (fine).
- Empty states have excellent Persian copy and almost no visual design.
- Errors use `friendlyError` — keep mapping; only the frame should change.
- Import screen hardcodes `Color(0xFF6F645C)` instead of `AppColors.muted`.

### 2.14 RTL / mixed direction

Strengths: `fa_IR` locale, `LtrText` for phones/filenames, email/password LTR, amounts LTR on dashboard metrics and visit list, Jalali picker forces RTL, back button uses `BackButtonIcon` on create-customer.

Problems:

- Profile «مدیریت خدمات» uses `Icons.arrow_forward` (points the wrong way in RTL). Use `Icons.arrow_forward_ios` / `Directionality`-aware chevron.
- Visits tab and record-visit use `Icons.event` / `event_available` (calendar/booking metaphor).
- Customer-detail visit subtitle mixes Persian service and amount in one RTL run.
- Time on record-visit is Persian digits but the time picker itself is Gregorian Material UI.

### 2.15 Responsive / desktop

- Dashboard `LayoutBuilder` two-column wrap is the only adaptive layout.
- Customer picker dialog is fixed `420×420`.
- Jalali dialog content width is fixed `320`.
- No `ConstrainedBox` for form width on Windows.
- Customer detail FAB padding `96` bottom is a local hack, not a token.
- Shell does not wrap `SafeArea` itself (OK; children/AppBars usually do). Register/login use SafeArea only on login.

### 2.16 Accessibility

- Status is color + text (text saves it), but NEW/RETURNING are weak.
- Touch targets: 48px buttons, 84px nav — OK. Dense action `Wrap` on opportunities can shrink tap areas on small widths.
- `StatusBadge` has `Semantics(label:)`.
- No skeleton; spinner-only is worse for layout shift and for “which section is loading.”
- Contrast on light theme is acceptable. A future dark theme must keep champagne-on-charcoal WCAG-sensible (accent for actions, not body text).

### 2.17 Anti-AI-generated-UI signals already present

- Equal metric card grid
- Repeated bordered rounded cards
- Pill badges + chips together on detail
- Extended FABs on three screens
- Calendar icons on a non-calendar product
- Full-screen spinners
- Inconsistent list vs card language

Not present (good): purple gradients, glassmorphism, fake charts, stock illustrations.

---

## 3. Target design principles

Adapt Zest’s **philosophy**, not its healthcare branding.

1. **Attention first.** Today must answer «توجه سالن باید کدام سمت بره؟» with one hero, then support.
2. **One accent.** Champagne / muted gold on charcoal. Success / warning / danger stay restrained and secondary.
3. **Dark premium surfaces.** Near-black background, charcoal surface, slightly lifted elevated surface. Not pure black; not gold luxury template.
4. **Information widgets, not card spam.** Hero insight, compact metric rows, list rows, one elevated action region.
5. **Numbers as objects.** At-risk count, reactivation count, month revenue — large, tabular, Persian digits (already via `toPersianDigits` for counts).
6. **Progressive disclosure.** Insight → why → action. Do not flatten all eight KPIs.
7. **Calm density.** Keep existing data; reduce chrome.
8. **Spacing scale.** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40.
9. **Icons for hierarchy**, not decoration. Status + primary actions only.
10. **DATA → INSIGHT → OPPORTUNITY → ACTION** must be readable on Today, Opportunities, and Customer detail.

Emotional target: calm, premium, intelligent, slightly feminine, never childish. Women’s beauty salon **business** product.

Preserve exact product terminology (completed visit, not booking). Preserve `AppStrings` user-facing sentences unless a purely visual grouping needs a new **section** label that does not change meaning. Prefer existing strings.

---

## 4. Proposed design system (Phase 2 — not built yet)

Minimal layer. Extend `app_theme.dart` + `app_widgets.dart`; add tokens file if colors/spacing overflow the theme class.

### 4.1 Color tokens (conceptual)

| Token | Role |
| --- | --- |
| `bg` | Very dark charcoal |
| `surface` | Dark charcoal |
| `surfaceElevated` | Slightly lighter charcoal |
| `line` | Low-contrast border |
| `textPrimary` | Warm white |
| `textSecondary` | Soft gray |
| `accent` | Champagne / muted gold (actions, hero number, active nav) |
| `accentMuted` | Accent at low opacity for selected chips / nav indicator |
| `success` | Restrained green |
| `warning` | Warm amber |
| `danger` | Restrained red |
| `info` | Subtle cool, only if needed |

No scattered `Color(0x…)` in screens. Replace import-screen hardcoded muted.

`AppTheme.light()` is currently the only theme and is referenced by tests. Phase 2 should introduce `AppTheme.dark()` (or make `AppTheme.app()` the dark product theme) and keep a named constructor so `persian_ui_test.dart` still compiles. Widget tests that wrap `MaterialApp` **without** `AppTheme` will pick the new widgets’ hardcoded tokens if we are not careful — prefer `Theme.of(context)` everywhere.

### 4.2 Typography scale (Vazirmatn, keep files)

| Role | Approx | Weight |
| --- | --- | --- |
| Display / attention question | 22–24 | w600 |
| Hero KPI | 32–40 | w500 |
| Section title | 16–18 | w600 |
| Card/row title | 15–16 | w500 |
| Body | 15 | w400 |
| Secondary | 13 | w400 |
| Caption / metadata | 12 | w400 |
| Nav | 12 | w500 |

Do not bold everything. Numbers: same family, slightly tracking-tight, Persian digits for counts; LTR for money strings that include Latin decimals from the API (`0.00`) — keep existing numeric strings, only presentation.

### 4.3 Shape

| Use | Radius |
| --- | --- |
| Hero insight | 20 |
| Sheets / dialogs | 20 |
| Compact blocks / inputs / buttons | 12 |
| List highlight | 8 |
| Status | 8 (not pill-everything) |

### 4.4 Spacing / sizes

- Page padding 16 (phone), 24 when width > 720 with max content width ~560–640 for forms.
- Section gap 24–32.
- Button height 48; input height ~52.
- Icon 20 default, 24 nav.
- Min touch 48.

### 4.5 Components to keep and restyle

| Existing | Keep behavior | Visual change |
| --- | --- | --- |
| `AppButton` | loading disables press | Dark filled / accent |
| `AppTextField` | same props | Dark fill, 12 radius, LTR as passed |
| `LtrText` | keep | inherit styles |
| `LoadingView` | same widget | optional small indicator; add `LoadingSkeleton` sibling for lists |
| `ErrorView` | same `friendlyError` + retry | calm frame, icon, Persian already |
| `EmptyStateView` | title/body/action | small icon slot, no illustration |
| `StatusBadge` | same status strings | icon + label + surface, distinguish NEW / RETURNING / ACTIVE |
| `MetricCard` | same data | become `MetricWidget` — less card, more number |
| `AppCard` | optional | `AppSurface` with elevation enum, not default everywhere |
| `OpportunityCard` | same fields + footer + onTap | reorder hierarchy |
| `CustomerListTile` | name + phone + onTap | denser row; no fake status |
| `PagedFooter` / `PagedNotificationListener` | **do not change load logic** | spinner color only |
| `OpportunityActionBar` | same API calls | quieter buttons; OPEN vs resolved styling |
| `ActionHistoryTile` | same fields | COMPLETED/DISMISSED surface language |
| `JalaliDatePickerDialog` | same conversion | restyle grid to dark theme |

### 4.6 Components to create (only if reused)

- `AppScaffold` — optional; may be overkill if `Theme` + `Scaffold` suffice  
- `SectionHeader`  
- `InsightHero` — Today primary widget from **existing** summary + first opportunity  
- `MetricWidget` / `MetricRow`  
- `PrimaryButton` / `SecondaryButton` if `AppButton` splits  
- `AppNavBar` theme only (keep `NavigationBar` + destinations)  

Do not build a large widget library.

---

## 5. Screen-by-screen redesign plan

Visual only. Same routes, same fetches, same buttons, same validation.

### 5.1 App shell / navigation

- Dark nav surface, 1px top line, champagne indicator, quieter inactive icons.
- Keep five labels and `context.go` mapping.
- Fix any icon metaphors that imply booking (`event_available` → a completed-check or spa-neutral icon **if** tests don’t key on the icon type; they currently key on labels).
- Active state obvious, not oversized. Height ~72–80, not a giant bar.

### 5.2 Today / Dashboard

Proposed structure using **existing** fields only:

1. Greeting line from existing `user?.name` and salon name (already loaded).
2. Display treatment of `AppStrings.attentionQuestion`.
3. **Hero:** if opportunities non-empty, first opportunity as the attention object (name, type, localized reason, recommended action, existing action bar). If empty, hero uses `atRisk` / `reactivationOpportunities` / `caughtUpTitle` — all existing.
4. Compact row: at-risk, inactive, reactivation, customer-return — not an 8-grid. Remaining counts (`active`, `new`, `returning`, `frequent`, `customers`) as a secondary metric row or disclosure, still real data, not fake.
5. Revenue widget: `revenueThisUtcMonth` dominant, `totalRevenue` secondary, keep UTC note string if still shown.
6. Rest of opportunity list (pagination unchanged).

Do not add charts or trend %.

### 5.3 Opportunities

- Keep type chips and history pagination order.
- Restyle chips to accent-muted selected state.
- Card hierarchy: type → reason → customer → status → recommended → actions.
- History: quieter surfaces; COMPLETED vs DISMISSED vs OPEN without new states.

### 5.4 Customer list

- Keep search-on-submit / clear-on-empty (behavior).
- Native-feeling search field on dark surface.
- Elegant rows: name, LTR phone, chevron. **Cannot** add last-visit or intelligence without API — see §8.
- Replace or visually calm the extended FAB; do not remove add/import actions.
- Skeleton rows instead of full-screen spinner when possible (state flags unchanged).

### 5.5 Customer detail

- Premium header: name, LTR phone, status with icon.
- Then intelligence explanation + behavior numbers already on the model (`daysSinceLastVisit`, `expectedReturnIntervalDays`, `visitCount`, averages).
- Then revenue block (existing strings/notes).
- Then visit history rows (date / service / LTR amount); delete remains manager-only, visually secondary.
- Then actions (existing bars).
- Keep «ثبت مراجعه» prominent; visually separate sale path on the record screen, not here.
- Relocate «افزودن مشتری» out of the crowded AppBar if possible **without removing the action** (e.g. keep it reachable). Removing it would be IA change — do not remove.

### 5.6 Record completed visit

- Keep hint copy, Jalali date, local time, future-date constraint via existing `lastDate: DateTime.now()`, idempotency, sale rules.
- Restyle date/time as compact selectors (not booking calendar).
- Group service + amount as “درآمد این مراجعه” only when role already shows those fields.
- Use Jalali visual language consistently.

### 5.7 Visits

- Keep filters, export, delete, pagination.
- **Presentation fix:** use existing `showJalaliDatePicker` + `replaceLocalDateKeepingTime` / date-only local day so the filter UI matches record-visit. Same `DateTime` day semantics as now (`_dateOnly` + repository `day:`). This is UI calendar chrome, not a backend change.
- Rows: stronger type hierarchy; amount LTR; no card-per-row.

### 5.8 Services

- Light restyle: name, active/inactive badge (not only subtitle), overflow menu stays OWNER-only because the route is OWNER-gated today.
- No price. Empty state with small icon + existing strings.

### 5.9 Profile

- Calm identity block (salon name, user, role).
- Optional display of existing `phone`/`address` if non-null — not new fields.
- Services row with RTL-correct chevron.
- Logout secondary, not a red panic button.

### 5.10 Authentication

- Same fields and validation.
- Typography + spacing + accent rule; max-width on wide windows.
- Splash: branded quiet mark + small indicator, not a naked spinner.

### 5.11 Empty / loading / error

- `EmptyStateView`: 24px icon + existing title/body/action.
- Lists: skeleton matching row height.
- `ErrorView`: icon, message, retry. Never raw exceptions (already mapped).

### 5.12 Bale composer

- Sheet surface, grab handle, hierarchy: customer name → opportunity type label (already in caller as `opportunityType`; **display** it with `opportunityLabel`) → textarea → confirm/send.
- Showing `opportunityLabel(opportunityType)` is presentation of an existing argument, not a new API.
- Keep confirmation dialog and polling loop.

---

## 6. Components to reuse

`AppButton`, `AppTextField`, `LtrText`, `ErrorView`, `EmptyStateView`, `StatusBadge`, `OpportunityCard`, `CustomerListTile`, `OpportunityActionBar`, `ActionHistoryTile`, `PagedNotificationListener`, `JalaliDatePickerDialog`, all `AppStrings` / `statusLabel` / `localizeIntelligenceCopy`.

---

## 7. Components to create

Small set listed in §4.5–4.6. Prefer evolving `app_widgets.dart` over a new package.

---

## 8. Risky areas and hard stops

### 8.1 Do not implement (would be engineering)

| Desire | Why blocked |
| --- | --- |
| Last visit / intelligence status on customer **list** | `Customer` JSON has no those fields; list endpoint would need change |
| Fake retention %, scores, charts, trends | No such API fields |
| Auto-campaigns, booking, calendar IA | Product forbids |
| Change action lifecycle, message send, pagination, auth | Business logic |
| Rewrite `defaultBaleMessage` | Changes sent text |
| New section copy that implies booking | Terminology |
| `AuthController` / repository / DTO changes | Out of scope |

If Phase 2+ is tempted to “just add status to the list,” **stop and report**. The list remains name + phone.

### 8.2 Presentation changes that look like logic but are allowed

- Reordering widgets on a screen.
- Using summary fields that are already fetched but unused (`returning`, `frequent`, …).
- Showing `behavior` integers already on customer intelligence.
- Showing `opportunityType` in the composer UI.
- Jalali chrome on the Visits **filter** with the same local-day `DateTime` already passed to `VisitRepository.list`.
- Replacing `CircularProgressIndicator` visuals — **update Flutter widget tests** that `find.byType(CircularProgressIndicator)` (`widget_flow_test.dart` around login loading and similar). Do not change API/e2e tests.

### 8.3 Files that mix UI and behavior

`customer_screens.dart`, `dashboard_screen.dart`, `opportunities_screen.dart`, `opportunity_action_bar.dart`, `bale_message_composer.dart` contain fetch/pagination. Extract widgets **without** editing request payloads, cursors, or `setState` machine. Highest merge-conflict and regression risk.

### 8.4 Tests that pin chrome

- `persian_ui_test.dart`: RTL + five nav labels + attention question string.
- `widget_flow_test.dart`: Persian copy, composer confirmation, empty states, `CircularProgressIndicator`.
- Keys: `visit-date-tile`, `visit-time-tile` must remain.

Keep `AppTheme.locale` and nav labels.

### 8.5 Working tree

Unrelated dirty files under `apps/api` and `apps/worker` must not be part of any UI commit.

---

## 9. Files likely to change (Phase 2+)

Presentation / theme / screen composition / Flutter tests that assert widgets:

```text
apps/mobile/lib/main.dart
apps/mobile/lib/core/theme/app_theme.dart
apps/mobile/lib/core/widgets/app_widgets.dart
apps/mobile/lib/features/shell/app_shell.dart
apps/mobile/lib/features/dashboard/dashboard_screen.dart
apps/mobile/lib/features/opportunities/opportunities_screen.dart
apps/mobile/lib/features/opportunities/opportunity_action_bar.dart
apps/mobile/lib/features/opportunities/bale_message_composer.dart
apps/mobile/lib/features/customers/customer_screens.dart
apps/mobile/lib/features/customers/customer_import_screen.dart
apps/mobile/lib/features/customers/customer_edit_loader.dart
apps/mobile/lib/features/visits/visits_screen.dart
apps/mobile/lib/features/services/service_screens.dart
apps/mobile/lib/features/profile/profile_screen.dart
apps/mobile/lib/features/auth/auth_screens.dart
apps/mobile/lib/shared/jalali_date_picker.dart
apps/mobile/test/persian_ui_test.dart
apps/mobile/test/widget_flow_test.dart
docs/ui-design-audit.md
```

Possibly a new `apps/mobile/lib/core/theme/app_tokens.dart` for spacing/radii.

`labels.dart` should change only if a **purely visual** string is missing and does not alter business meaning. Default: **do not change** intelligence localization or error maps.

---

## 10. Files that must NOT change

### Backend / data / domain

```text
apps/api/**
apps/worker/**
packages/**
infra/**
any Prisma schema or migration
```

### Flutter non-presentation (behavior, contracts, storage)

```text
apps/mobile/lib/core/networking/api_client.dart
apps/mobile/lib/core/networking/repositories.dart
apps/mobile/lib/core/state/providers.dart
apps/mobile/lib/core/storage/session_store.dart
apps/mobile/lib/core/config/api_config.dart
apps/mobile/lib/core/errors/api_exception.dart
apps/mobile/lib/shared/models/models.dart
apps/mobile/lib/shared/jalali.dart          # conversion & formatting functions
apps/mobile/lib/features/customers/customer_validation.dart
apps/mobile/lib/features/services/service_validation.dart
apps/mobile/lib/shared/platform/excel_file_saver.dart
apps/mobile/lib/core/routing/app_router.dart  # destinations/redirects
```

`app_router.dart`: **no new routes, no redirect changes**. Theme wrappers belong in `MaterialApp` / widgets, not new paths.

Jalali **math** stays in `jalali.dart`. Visual picker chrome may change in `jalali_date_picker.dart`.

### Tests that encode business rules

```text
apps/mobile/test/api_client_test.dart
apps/mobile/test/auth_controller_test.dart
apps/mobile/test/customer_validation_test.dart
apps/mobile/test/customer_import_test.dart
apps/mobile/test/integration_api_test.dart
apps/mobile/test/jalali_test.dart
apps/mobile/test/jalali_picker_test.dart     # unless picker chrome assertions break; then visual-only test updates
apps/mobile/test/labels_test.dart
apps/mobile/test/models_test.dart
apps/mobile/test/session_store_test.dart
apps/mobile/test/visit_form_test.dart        # validation/idempotency/role; keep behavior assertions
apps/api/**/*.spec.ts
apps/api/test/**
apps/worker/**/*.spec.ts
```

---

## 11. Implementation order (after this audit)

Per the brief; do not start until this document is accepted:

1. Design tokens + dark theme + restyle shared widgets  
2. Shell  
3. Today  
4. Opportunities  
5. Customer list  
6. Customer detail  
7. Record visit  
8. Visits  
9. Services  
10. Profile  
11. Auth  
12. Empty/loading/error  
13. Bale composer  

After each major screen: `flutter analyze`, `flutter test`, visual pass. Backend `pnpm test` / `pnpm test:e2e` at the end of the full redesign, not as a reason to edit API tests.

---

## 12. Phase 1 confirmation

- No Flutter or backend source was modified for this phase except adding this document.
- Redesign work must not begin until Phase 1 is complete — **this file is that completion.**
- Canonical product copy to keep as a visual anchor: **توجه سالن باید کدام سمت بره؟**
)
