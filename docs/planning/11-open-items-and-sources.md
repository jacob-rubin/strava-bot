---
status: authoritative
last-updated: 2026-09-13
---

← [Index](../PLANNING.md)

## 15. Open items

| #   | Item                                                                          | Blocks                                 | How to resolve                               |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------ |
| 1   | Does the share sheet deliver full text or only the URL?                       | client choice                          | `Quick Look` on Shortcut Input ([§14](10-build-order-and-client.md#14-client--ios-shortcut)) |
| 2   | Is the `link.strong.app` slug stable across shares?                           | nothing — content-hash guard covers it | share one workout twice, compare             |
| 3   | Does `POST /uploads` accept JSON, and is the field `data_type` or `dataType`? | Phase 2 only                           | `scripts/probe_upload_json.ts`               |
| 4   | Does `POST /activities` require `type` alongside `sport_type`?                | nothing — send both                    | observe the 400                              |
| 5   | Set-format coverage beyond the six known variants                             | nothing — `unparsed` is retained       | share unusual movements, grep for `unparsed` |

None of these block items 1–6 of [§13](10-build-order-and-client.md#13-build-order).

## Sources

- [Getting Started](https://developers.strava.com/docs/getting-started/) — app setup, authorize/token URLs, token lifetime, rate limits
- [API Reference](https://developers.strava.com/docs/reference/) — createActivity, createUpload, getUploadById, Upload object, Fault
- [Authentication](https://developers.strava.com/docs/authentication/) — scope definitions, refresh request
- [Rate Limits](https://developers.strava.com/docs/rate-limits/) — buckets, headers, 429
- [Uploads](https://developers.strava.com/docs/uploads/) — async processing, polling interval
- [API Changelog](https://developers.strava.com/docs/changelog/) — 2026-05-21 structured set data; 2026-06-01 tier changes
- [API Policy](https://www.strava.com/legal/api_policy) — §5.3

---

← [Index](../PLANNING.md) · Previous: [Build order and client](10-build-order-and-client.md)
