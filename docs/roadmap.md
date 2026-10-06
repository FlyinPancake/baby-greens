# baby greens roadmap

What's done and what might come next. [design.md](design.md) describes how the app works now.

## Out of scope

- Business use cases like order tracking. You can fork the project and modify it to suit your needs.

## Done

1. OIDC login, sessions, the `AuthUser` extractor, the Origin check, and `/api/me`.
2. The plant definition format, 15 built-in plants, custom plants, and the scheduling logic.
3. The plant, batch, and task API under `/api/v1`, the generated TypeScript client, the today view,
   batch pages, and the JSON plant editor.
4. PWA install, push subscriptions, the reminder job, snoozing, and quiet hours.
5. Offline support with the saved Query cache and the outbox, and the harvest log with yield stats.
6. The container image, the production compose file with optional backups, CI that publishes to
   GHCR, and the deploy guide.
7. Shared batches. Everyone on the server sees and tends every batch and gets its reminders.

## Next: integrations

These all go through the same `/api/v1` API, so they come first.

- Bearer tokens for a native app / api authentication.
- An MQTT bridge for Home Assistant, for due tasks and step changes. The reminder job only knows
  about push today, so this needs events such as "task became due" and "step changed" that both push
  and MQTT can listen to.
- Home Assistant App with integrated authentication.

## Later

In no particular order:

- A native mobile app on the same API, with APNs or FCM as further notifiers.
- Photos per batch, shown as a timeline.
- Seed inventory that subtracts what each batch uses.
- Problem notes and a checklist for common issues, such as root hairs vs. mold.
- Succession planning, like "start a radish tray every 4 days".
- Separate households on one server. Today every account shares everything, so one server is one
  household.

## Maintenance

- Upgrade to sqlx 0.9 and tower-sessions 0.15 once `tower-sessions-sqlx-store` publishes a release
  with sqlx 0.9. The change is merged upstream but not released.
- RP-initiated logout, so signing out also ends the session at the provider. Dex doesn't support it,
  so it waits until it matters with the real provider.
