# FOMO Staff Portal

Staff Portal for Sales + Admin operations with role-aware navigation, branch scoping, and API-driven modules.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- JWT authentication (via existing backend)
- Role-based routing (middleware + client guard)

## Services Integrated

- `users-service`
- `subscription-service`
- `engagement-service`
- `training-service`

## Implemented Modules

- Login (`/login`) with mobile + password
- Branch Selector (`/branch-selector`)
- Sales Dashboard (`/portal/sales-dashboard`)
- Inquiry Kanban (`/portal/inquiries`)
- Member Management (`/portal/members`)
- Quick Billing (`/portal/billing`)
- Trainer Attendance (`/portal/trainer-attendance`)
- Class Schedule (`/portal/class-schedule`)
- Accounts Dashboard (`/portal/accounts`)

## Environment Variables

Copy `.env.example` into `.env.local` and set API gateway URL:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8081
NEXT_PUBLIC_USERS_API_PREFIX=/api/users
```

## Run

```bash
npm run dev
```

## Integration Tests (Backend)

Run users-service integration tests:

```bash
FOMO_TEST_MOBILE=9000005001 \
FOMO_TEST_PASSWORD=your_password \
npm run test:integration
```

Write/create tests for member/trainer/staff registration are disabled by default. Enable them only in a safe test environment:

```bash
FOMO_TEST_MOBILE=9000005001 \
FOMO_TEST_PASSWORD=your_password \
FOMO_INTEGRATION_WRITE=true \
npm run test:integration
```

## Architecture Notes

- API calls are centralized under `src/lib/api/services/*`.
- Branch selection is global via `BranchProvider`; it is UI-only and not sent to backend APIs.
- Middleware (`/middleware.ts`) protects routes and enforces role access.
- Plans are fetched dynamically from `subscription-service` in quick billing; no hardcoded plans.
